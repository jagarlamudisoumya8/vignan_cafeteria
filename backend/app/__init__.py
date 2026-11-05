from flask import Flask, jsonify
from flask_cors import CORS
from flask_pymongo import PyMongo
from config import Config

mongo = PyMongo()


def create_app(config=None):
    app = Flask(__name__)
    app.config.from_object(Config)
    if config:
        app.config.update(config)
    origins = [
        origin.strip()
        for origin in app.config["FRONTEND_ORIGIN"].split(",")
        if origin.strip()
    ]
    CORS(app, origins=origins, supports_credentials=False)
    mongo.init_app(app)
    mongo.db = mongo.cx[app.config["MONGO_DB_NAME"]]
    from .routes import register_routes
    register_routes(app)

    @app.get("/api/health")
    def health():
        try:
            mongo.cx.admin.command("ping")
            return jsonify(status="ok", database="connected")
        except Exception:
            app.logger.exception("Database health check failed")
            return jsonify(status="degraded", database="unavailable"), 503

    return app
