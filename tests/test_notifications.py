import os
import time
import json
import tempfile
import pytest
from unittest.mock import MagicMock, patch
from dataclasses import asdict

from api.notifications.models import AlertPayload, NotificationResult
from api.notifications.telegram import TelegramNotifier
from api.notifications.slack import SlackNotifier
from api.notifications.webhook import GenericWebhookNotifier
from api.notifications.email_smtp import EmailSMTPNotifier
from api.notifications.dispatcher import NotificationDispatcher
from api import db
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)


@pytest.fixture
def sample_payload():
    return AlertPayload(
        incident_id="inc_test_999",
        camera_id="cam_01",
        camera_name="Camera 01: North Junction",
        timestamp_iso="2026-11-25T19:00:00Z",
        zone_id=1,
        confidence=0.92,
        vehicles_involved=[2, 4],
        speed_kmh=58.5,
        speed_loss_kmh=36.0,
        severity="CRITICAL",
        incident_url="http://localhost:5173/incidents/inc_test_999",
        snapshot_path=None,
    )


# ==============================================================================
# CHANNEL UNIT TESTS (Mocked HTTP & SMTP)
# ==============================================================================

def test_telegram_send_success_and_fallback(sample_payload):
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
        f.write(b"fake_jpeg_bytes")
        snap_path = f.name

    sample_payload.snapshot_path = snap_path
    notifier = TelegramNotifier(bot_token="fake_token_123", chat_id="123456")

    # 1. Test photo send success
    with patch("requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_post.return_value = mock_resp

        result = notifier.send(sample_payload)
        assert result.success is True
        assert result.channel == "telegram"
        assert mock_post.called
        assert "sendPhoto" in mock_post.call_args[0][0]

    # 2. Test photo send failure fallback to text message
    with patch("requests.post") as mock_post:
        # First call (photo) returns 500, second call (text message) returns 200
        resp_500 = MagicMock(status_code=500, text="Photo error")
        resp_200 = MagicMock(status_code=200, text="OK")
        mock_post.side_effect = [resp_500, resp_200]

        result = notifier.send(sample_payload)
        assert result.success is True
        assert mock_post.call_count == 2
        assert "sendMessage" in mock_post.call_args_list[1][0][0]

    # Cleanup temp file
    if os.path.exists(snap_path):
        os.remove(snap_path)


def test_slack_block_kit_payload(sample_payload):
    notifier = SlackNotifier(webhook_url="https://hooks.slack.com/services/T00/B00/XXX")
    assert notifier.is_configured() is True

    with patch("requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = "ok"
        mock_post.return_value = mock_resp

        result = notifier.send(sample_payload)
        assert result.success is True
        assert result.channel == "slack"

        # Verify Block Kit structure
        sent_body = mock_post.call_args[1]["json"]
        assert "blocks" in sent_body
        headers = [b for b in sent_body["blocks"] if b["type"] == "header"]
        assert len(headers) == 1
        assert "Road Accident Detected" in headers[0]["text"]["text"]


def test_generic_webhook_hmac_signature(sample_payload):
    secret = "test_signing_key_secret"
    notifier = GenericWebhookNotifier(
        webhook_url="https://api.external.com/dispatch",
        secret=secret,
    )
    assert notifier.is_configured() is True

    with patch("requests.post") as mock_post:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_post.return_value = mock_resp

        result = notifier.send(sample_payload)
        assert result.success is True

        headers = mock_post.call_args[1]["headers"]
        assert "X-TrafficMonitor-Signature" in headers
        assert headers["X-TrafficMonitor-Signature"].startswith("sha256=")
        assert headers["X-Event-Type"] == "incident_alert"


def test_smtp_email_send_and_inline_attachment(sample_payload):
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
        f.write(b"\xff\xd8\xff\xe0fake_jpeg")
        snap_path = f.name

    sample_payload.snapshot_path = snap_path
    notifier = EmailSMTPNotifier(
        host="smtp.fake.com",
        port=587,
        username="alerts@fake.com",
        password="fakepassword",
        to_addrs=["operator@fake.com"],
        use_tls=True,
    )
    assert notifier.is_configured() is True

    with patch("smtplib.SMTP") as mock_smtp:
        mock_server = MagicMock()
        mock_smtp.return_value = mock_server

        result = notifier.send(sample_payload)
        assert result.success is True
        assert result.channel == "email"

        # Verify SMTP server lifecycle
        mock_server.starttls.assert_called_once()
        mock_server.login.assert_called_once_with("alerts@fake.com", "fakepassword")
        assert mock_server.sendmail.called
        mock_server.quit.assert_called_once()

    if os.path.exists(snap_path):
        os.remove(snap_path)


# ==============================================================================
# DISPATCHER RELIABILITY TESTS (Retries, Deduplication, Cooldown)
# ==============================================================================

def test_dispatcher_retry_exponential_backoff_and_permanent_failure(sample_payload):
    dispatcher = NotificationDispatcher(cooldown_seconds=10.0)

    mock_notifier = MagicMock()
    mock_notifier.is_configured.return_value = True

    # 1. Test retry with success on 3rd attempt
    fail_res = NotificationResult(channel="mock_ch", success=False, error="Temporary 503")
    ok_res = NotificationResult(channel="mock_ch", success=True)
    mock_notifier.send.side_effect = [fail_res, fail_res, ok_res]

    dispatcher.channels = {"mock_ch": mock_notifier}

    # Speed up backoff sleep in tests
    with patch("time.sleep", return_value=None) as mock_sleep:
        dispatcher._process_dispatch(sample_payload, specific_channels=["mock_ch"])
        assert mock_notifier.send.call_count == 3
        # Assert sleep backoff was called twice (1s, 2s)
        assert mock_sleep.call_count == 2

    # Verify DB recorded sent state with 3 attempts
    logs = db.get_incident_notifications(sample_payload.incident_id)
    sent_log = next((l for l in logs if l["channel"] == "mock_ch"), None)
    assert sent_log is not None
    assert sent_log["status"] == "sent"
    assert sent_log["attempts"] == 3

    # 2. Test permanent failure after 3 attempts
    mock_notifier.reset_mock()
    mock_notifier.send.side_effect = [fail_res, fail_res, fail_res]
    sample_payload.incident_id = "inc_perm_fail_999"

    with patch("time.sleep", return_value=None):
        dispatcher._process_dispatch(sample_payload, specific_channels=["mock_ch"])
        assert mock_notifier.send.call_count == 3

    logs_fail = db.get_incident_notifications("inc_perm_fail_999")
    fail_log = next((l for l in logs_fail if l["channel"] == "mock_ch"), None)
    assert fail_log is not None
    assert fail_log["status"] == "failed"
    assert fail_log["attempts"] == 3
    assert "Temporary 503" in fail_log["last_error"]


def test_dispatcher_deduplication_and_cooldown_suppression(sample_payload):
    dispatcher = NotificationDispatcher(cooldown_seconds=60.0)
    dispatcher.queue = MagicMock()

    # 1. First alert for incident 1 -> accepted
    p1 = AlertPayload(
        incident_id="inc_cooldown_1",
        camera_id="cam_cooldown_test",
        camera_name="Test Cam",
        timestamp_iso="2026-11-25T19:00:00Z",
        zone_id=1,
        confidence=0.90,
        vehicles_involved=[1],
    )
    assert dispatcher.dispatch_async(p1) is True

    # 2. Duplicate dispatch for incident 1 -> deduplicated (False)
    assert dispatcher.dispatch_async(p1) is False

    # 3. Different incident 2 on SAME camera immediately within 60s cooldown -> suppressed (False)
    p2 = AlertPayload(
        incident_id="inc_cooldown_2",
        camera_id="cam_cooldown_test",
        camera_name="Test Cam",
        timestamp_iso="2026-11-25T19:00:05Z",
        zone_id=2,
        confidence=0.90,
        vehicles_involved=[2],
    )
    assert dispatcher.dispatch_async(p2) is False

    # Check that suppression was recorded in DB
    logs_suppressed = db.get_incident_notifications("inc_cooldown_2")
    assert any(l["status"] == "suppressed" for l in logs_suppressed)

    # 4. Manual test alert with is_test=True -> bypasses cooldown
    p_test = AlertPayload(
        incident_id="test_cooldown_override",
        camera_id="cam_cooldown_test",
        camera_name="Test Cam",
        timestamp_iso="2026-11-25T19:00:10Z",
        zone_id=3,
        confidence=0.99,
        vehicles_involved=[3],
        is_test=True,
    )
    assert dispatcher.dispatch_async(p_test) is True


# ==============================================================================
# REST API ENDPOINT TESTS
# ==============================================================================

def test_notification_api_endpoints():
    # 1. GET /api/notifications/settings
    res = client.get("/api/notifications/settings")
    assert res.status_code == 200
    data = res.json()
    assert "cooldown_seconds" in data
    assert "channels" in data
    assert "telegram" in data["channels"]
    assert "slack" in data["channels"]

    # 2. POST /api/notifications/settings
    res_up = client.post("/api/notifications/settings", json={"cooldown_seconds": 45.0})
    assert res_up.status_code == 200
    assert res_up.json()["cooldown_seconds"] == 45.0

    # 3. POST /api/notifications/test/{channel}
    res_test = client.post("/api/notifications/test/webhook")
    assert res_test.status_code == 200
    assert res_test.json()["status"] in ("queued", "rejected")

    # Invalid channel returns 400
    res_bad = client.post("/api/notifications/test/invalid_channel_name")
    assert res_bad.status_code == 400

    # 4. GET /api/incidents/{incident_id}/notifications
    # Insert test incident into DB first
    db.insert_incident(
        incident_id="inc_test_999",
        camera_id="cam_01",
        session_id="sess_test",
        zone_id=1,
        origin="detector",
        confirmed_at="2026-11-25T19:00:00Z",
        peak_conf=0.90,
        bbox=[0, 0, 10, 10],
        involved_ids=[1],
        snapshot_path="",
        clip_path="",
        settings={},
        model_info={},
    )
    res_notifs = client.get("/api/incidents/inc_test_999/notifications")
    assert res_notifs.status_code == 200
    assert isinstance(res_notifs.json(), list)
