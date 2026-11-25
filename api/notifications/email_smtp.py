import os
import smtplib
import logging
from typing import Optional, List
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage

from api.notifications.base import BaseNotifier
from api.notifications.models import AlertPayload, NotificationResult

logger = logging.getLogger("TrafficMonitor.Notifications.Email")


class EmailSMTPNotifier(BaseNotifier):
    """
    Dispatches alerts via SMTP email with HTML body and attached/embedded snapshot image.
    """
    channel_name: str = "email"

    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        from_addr: Optional[str] = None,
        to_addrs: Optional[List[str]] = None,
        use_tls: Optional[bool] = None,
        use_ssl: Optional[bool] = None,
        timeout_seconds: float = 12.0,
    ):
        self.host = host or os.environ.get("SMTP_HOST", "").strip()
        port_env = os.environ.get("SMTP_PORT", "").strip()
        self.port = port or (int(port_env) if port_env.isdigit() else 587)
        self.username = username or os.environ.get("SMTP_USERNAME", "").strip()
        self.password = password or os.environ.get("SMTP_PASSWORD", "").strip()
        self.from_addr = from_addr or os.environ.get("SMTP_FROM", "").strip() or self.username
        
        to_env = os.environ.get("SMTP_TO", "").strip()
        self.to_addrs = to_addrs or ([addr.strip() for addr in to_env.split(",") if addr.strip()] if to_env else [])
        
        self.use_tls = use_tls if use_tls is not None else os.environ.get("SMTP_USE_TLS", "true").lower() in ("true", "1")
        self.use_ssl = use_ssl if use_ssl is not None else os.environ.get("SMTP_USE_SSL", "false").lower() in ("true", "1")
        self.timeout = timeout_seconds

    def is_configured(self) -> bool:
        return bool(self.host and self.to_addrs and (self.from_addr or self.username))

    def format_html(self, payload: AlertPayload) -> str:
        vehicles_str = ", ".join(f"#{v}" for v in payload.vehicles_involved) if payload.vehicles_involved else "N/A"
        speed_html = ""
        if payload.speed_kmh is not None:
            speed_html = f"<tr><td style='padding:6px;font-weight:bold;'>Speed:</td><td style='padding:6px;'>{payload.speed_kmh:.1f} km/h</td></tr>"
            if payload.speed_loss_kmh is not None:
                speed_html += f"<tr><td style='padding:6px;font-weight:bold;'>Deceleration:</td><td style='padding:6px;color:#e11d48;'>-{payload.speed_loss_kmh:.1f} km/h drop</td></tr>"
        elif payload.speed_px_s is not None and payload.speed_px_s > 0:
            speed_html = f"<tr><td style='padding:6px;font-weight:bold;'>Speed:</td><td style='padding:6px;'>{payload.speed_px_s:.0f} px/s</td></tr>"

        link_html = ""
        if payload.incident_url:
            link_html = f"""
            <div style='margin-top:20px;'>
                <a href='{payload.incident_url}' style='background-color:#e11d48;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold;display:inline-block;'>
                    Open Incident in Console
                </a>
            </div>
            """

        img_html = ""
        if payload.snapshot_path and os.path.exists(payload.snapshot_path):
            img_html = "<div style='margin-top:16px;'><img src='cid:snapshot_img' style='max-width:100%;border-radius:8px;border:1px solid #334155;' alt='Incident Snapshot' /></div>"

        test_banner = "<div style='background-color:#f59e0b;color:#000;padding:8px;font-weight:bold;text-align:center;border-radius:4px;margin-bottom:12px;'>TEST NOTIFICATION - NO ACTION REQUIRED</div>" if payload.is_test else ""

        return f"""
        <html>
        <body style='font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background-color:#0f172a;color:#f8fafc;padding:20px;'>
            <div style='max-width:600px;margin:0 auto;background-color:#1e293b;border-radius:12px;padding:24px;border:1px solid #334155;'>
                {test_banner}
                <h2 style='color:#f43f5e;margin-top:0;'>🚨 Road Accident Detected</h2>
                <table style='width:100%;border-collapse:collapse;font-size:14px;color:#e2e8f0;'>
                    <tr><td style='padding:6px;font-weight:bold;width:140px;'>Camera:</td><td style='padding:6px;'>{payload.camera_name} ({payload.camera_id})</td></tr>
                    <tr><td style='padding:6px;font-weight:bold;'>Timestamp:</td><td style='padding:6px;'>{payload.timestamp_iso}</td></tr>
                    <tr><td style='padding:6px;font-weight:bold;'>Zone ID:</td><td style='padding:6px;'>#{payload.zone_id}</td></tr>
                    <tr><td style='padding:6px;font-weight:bold;'>Confidence:</td><td style='padding:6px;'>{payload.confidence:.0%}</td></tr>
                    <tr><td style='padding:6px;font-weight:bold;'>Involved Vehicles:</td><td style='padding:6px;'>{vehicles_str}</td></tr>
                    <tr><td style='padding:6px;font-weight:bold;'>Severity:</td><td style='padding:6px;color:#f43f5e;font-weight:bold;'>{payload.severity}</td></tr>
                    {speed_html}
                </table>
                {img_html}
                {link_html}
                <hr style='border:0;border-top:1px solid #334155;margin:24px 0 12px 0;' />
                <p style='font-size:11px;color:#94a3b8;margin:0;'>Real-Time Road Accident Detection & Traffic Tracking System v2.1</p>
            </div>
        </body>
        </html>
        """

    def send(self, payload: AlertPayload) -> NotificationResult:
        if not self.is_configured():
            return NotificationResult(
                channel=self.channel_name,
                success=False,
                error="Email channel not configured (SMTP_HOST, SMTP_TO, or sender missing)",
            )

        subject_prefix = "🧪 [TEST ALERT] " if payload.is_test else "🚨 [ALERT] "
        subject = f"{subject_prefix}Accident on {payload.camera_name} (Zone #{payload.zone_id})"

        msg = MIMEMultipart("related")
        msg["Subject"] = subject
        msg["From"] = self.from_addr
        msg["To"] = ", ".join(self.to_addrs)

        html_content = self.format_html(payload)
        msg_alternative = MIMEMultipart("alternative")
        msg.attach(msg_alternative)
        msg_alternative.attach(MIMEText(html_content, "html"))

        # Attach snapshot image inline if exists
        if payload.snapshot_path and os.path.exists(payload.snapshot_path):
            try:
                with open(payload.snapshot_path, "rb") as f:
                    img_data = f.read()
                img_part = MIMEImage(img_data)
                img_part.add_header("Content-ID", "<snapshot_img>")
                img_part.add_header("Content-Disposition", "inline", filename="incident_snapshot.jpg")
                msg.attach(img_part)
            except Exception as e:
                logger.warning(f"Could not attach snapshot image to email: {self.sanitize_error(e)}")

        try:
            if self.use_ssl:
                server = smtplib.SMTP_SSL(self.host, self.port, timeout=self.timeout)
            else:
                server = smtplib.SMTP(self.host, self.port, timeout=self.timeout)
                if self.use_tls:
                    server.starttls()

            if self.username and self.password:
                server.login(self.username, self.password)

            server.sendmail(self.from_addr, self.to_addrs, msg.as_string())
            server.quit()
            return NotificationResult(channel=self.channel_name, success=True)
        except Exception as e:
            sanitized = self.sanitize_error(e)
            logger.error(f"SMTP dispatch error: {sanitized}")
            return NotificationResult(channel=self.channel_name, success=False, error=sanitized)
