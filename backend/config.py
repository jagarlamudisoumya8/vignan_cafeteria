
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    MONGO_URI = os.getenv("MONGO_URI")
    MONGO_DB_NAME = os.getenv(
        "MONGO_DB_NAME",
        "vignan_cafeteria"
    )

    JWT_SECRET = os.getenv("JWT_SECRET", "change-this-secret")
    JWT_EXPIRES_HOURS = int(
        os.getenv("JWT_EXPIRES_HOURS", "24")
    )

    FRONTEND_ORIGIN = os.getenv(
        "FRONTEND_ORIGIN",
        "http://localhost:5173"
    )
