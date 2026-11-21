import asyncio
import json
import logging
from typing import Set, Dict, Any

logger = logging.getLogger("TrafficMonitor.API.SSE")


class AlertEventBus:
    """
    Server-Sent Events (SSE) broadcast channel for real-time notifications:
    - confirmed
    - cleared
    - verdict
    - system_warning
    """

    def __init__(self):
        self._listeners: Set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._listeners.add(q)
        logger.debug(f"New SSE subscriber connected. Total subscribers: {len(self._listeners)}")
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._listeners.discard(q)
        logger.debug(f"SSE subscriber disconnected. Remaining: {len(self._listeners)}")

    async def broadcast(self, event_type: str, data: Dict[str, Any]):
        message = {
            "event": event_type,
            "data": data,
        }
        dead_queues = set()
        for q in self._listeners:
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                dead_queues.add(q)
            except Exception as e:
                logger.warning(f"Error publishing SSE message: {e}")
                dead_queues.add(q)

        for q in dead_queues:
            self._listeners.discard(q)


alert_bus = AlertEventBus()

