from abc import ABC, abstractmethod
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

class NotificationProvider(ABC):
    @abstractmethod
    async def send_notification(self, recipient: str, template_name: str, parameters: Dict[str, Any]) -> bool:
        pass

class WhatsAppProvider(NotificationProvider):
    async def send_notification(self, recipient: str, template_name: str, parameters: Dict[str, Any]) -> bool:
        logger.info(f"[WhatsApp Integration] Sent template '{template_name}' to {recipient} with params {parameters}")
        return True

class SMSProvider(NotificationProvider):
    async def send_notification(self, recipient: str, template_name: str, parameters: Dict[str, Any]) -> bool:
        logger.info(f"[SMS Integration] Sent SMS to {recipient} with message: {parameters.get('message')}")
        return True

class EmailProvider(NotificationProvider):
    async def send_notification(self, recipient: str, template_name: str, parameters: Dict[str, Any]) -> bool:
        logger.info(f"[Email Integration] Sent Email to {recipient} with subject: {parameters.get('subject')}")
        return True

whatsapp_provider = WhatsAppProvider()
sms_provider = SMSProvider()
email_provider = EmailProvider()
