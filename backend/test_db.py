
from pymongo import MongoClient
from config import Config

try:
    if not Config.MONGO_URI:
        raise ValueError("MONGO_URI is missing from .env")

    client = MongoClient(
        Config.MONGO_URI,
        serverSelectionTimeoutMS=10000
    )

    client.admin.command("ping")

    db = client[Config.MONGO_DB_NAME]

    print("MongoDB Connected Successfully!")
    print("Database:", db.name)

except Exception as e:
    print("MongoDB Connection Failed!")
    print("Error:", e)

finally:
    if "client" in locals():
        client.close()
