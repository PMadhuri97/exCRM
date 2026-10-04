import json
import os

from dotenv import load_dotenv

# Load environment variables from .env if present
load_dotenv()

#: The GCP audit sink (Cloud Logging → Log Sink → retention-locked bucket) is
#: **paused by default** (decision, 1 October 2026): with this off, no GCP setting
#: is needed to start, nothing is sent to Google, and audit entries still go to the
#: application log (and to the in-memory record tests read). Turn it on — with the
#: real settings below — when the immutable bucket is wanted again.
AUDIT_SINK_GCP_ENABLED: bool = os.environ.get("AUDIT_SINK_GCP_ENABLED", "false").strip().lower() in (
    "1",
    "true",
    "yes",
)


def _setting(name: str) -> str:
    """Required when the sink is on (fail fast, as before); a placeholder when paused."""
    if AUDIT_SINK_GCP_ENABLED:
        return os.environ[name]
    return os.environ.get(name) or "audit-sink-paused"


GCP_PROJECT_ID: str = _setting("GCP_PROJECT_ID")
AUDIT_BUCKET_NAME: str = _setting("AUDIT_BUCKET_NAME")
LOG_SINK_LOGGER_NAME: str = _setting("LOG_SINK_LOGGER_NAME")

# Try to resolve SERVICE_ACCOUNT_EMAIL from environment, or parse it from key JSON file if available
_email: str | None = os.environ.get("SERVICE_ACCOUNT_EMAIL")

if not _email:
    key_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or os.environ.get("GCP_SERVICE_ACCOUNT_KEY")
    if key_path and os.path.exists(key_path):
        try:
            with open(key_path) as f:
                data = json.load(f)
                _email = data.get("client_email")
        except Exception:
            pass

# Fail fast if SERVICE_ACCOUNT_EMAIL cannot be resolved — only while the sink is on.
if not _email:
    if AUDIT_SINK_GCP_ENABLED:
        raise KeyError(
            "SERVICE_ACCOUNT_EMAIL must be set in the environment or available in the GCP "
            "service account key file"
        )
    _email = "audit-sink-paused"

SERVICE_ACCOUNT_EMAIL: str = _email

# Set GOOGLE_APPLICATION_CREDENTIALS for the GCP SDK if not already set,
# using the path from GCP_SERVICE_ACCOUNT_KEY.
if "GOOGLE_APPLICATION_CREDENTIALS" not in os.environ and "GCP_SERVICE_ACCOUNT_KEY" in os.environ:
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.environ["GCP_SERVICE_ACCOUNT_KEY"]

# The compliance retention period for audit logs (defaults to 7 years / 2555 days)
AUDIT_BUCKET_RETENTION_DAYS: int = int(os.environ.get("AUDIT_BUCKET_RETENTION_DAYS", "2555"))

# The retention period for Cloud Logging buckets (defaults to 30 days)
CLOUD_LOGGING_RETENTION_DAYS: int = int(os.environ.get("CLOUD_LOGGING_RETENTION_DAYS", "30"))


