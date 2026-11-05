import re
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from bson import ObjectId
from flask import current_app, jsonify, request, g
from pymongo import ASCENDING, DESCENDING

from .. import mongo

STATUSES = ["Pending", "Confirmed", "Preparing", "Ready for Pickup", "Completed", "Cancelled"]
SAMPLE_FOODS = [
    {"food_name": "Masala Dosa", "description": "Crisp golden dosa with potato masala, coconut chutney and sambar.", "price": 65, "category_name": "Breakfast", "image": "https://images.unsplash.com/photo-1668236543090-82eba5ee5976?auto=format&fit=crop&w=900&q=85"},
    {"food_name": "Paneer Rice Bowl", "description": "Steamed rice, smoky paneer tikka, fresh greens and mint yogurt.", "price": 120, "category_name": "Lunch", "image": "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=85"},
    {"food_name": "Veggie Club Sandwich", "description": "Toasted multigrain bread layered with garden vegetables and house spread.", "price": 85, "category_name": "Snacks", "image": "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=85"},
    {"food_name": "Filter Coffee", "description": "Rich South Indian filter coffee, freshly brewed and served hot.", "price": 30, "category_name": "Drinks", "image": "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=900&q=85"},
    {"food_name": "Classic Veg Burger", "description": "Crispy veggie patty, lettuce, tomato and tangy house sauce.", "price": 95, "category_name": "Snacks", "image": "https://images.unsplash.com/photo-1520072959219-c595dc870360?auto=format&fit=crop&w=900&q=85"},
    {"food_name": "Fresh Fruit Bowl", "description": "A bright mix of seasonal fruit, prepared fresh each morning.", "price": 70, "category_name": "Breakfast", "image": "https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=900&q=85"},
]


def now():
    return datetime.now(timezone.utc)


def json_doc(doc):
    if not doc:
        return doc
    result = {**doc, "_id": str(doc["_id"])}
    if isinstance(result.get("user_id"), ObjectId):
        result["user_id"] = str(result["user_id"])
    if isinstance(result.get("items"), list):
        result["items"] = [{key: (str(value) if isinstance(value, ObjectId) else value) for key, value in item.items()} for item in result["items"]]
    return result


def error(message, status=400):
    return jsonify(error=message), status


def valid_object_id(value):
    return ObjectId(value) if ObjectId.is_valid(str(value)) else None


def token_required(admin=False):
    def decorate(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            header = request.headers.get("Authorization", "")
            token = header.removeprefix("Bearer ").strip()
            if not token:
                return error("Authentication required.", 401)
            try:
                payload = jwt.decode(token, current_app.config["JWT_SECRET"], algorithms=["HS256"])
            except jwt.PyJWTError:
                return error("Invalid or expired session.", 401)
            user_id = valid_object_id(payload.get("sub"))
            user = mongo.db.users.find_one({"_id": user_id}) if user_id else None
            if not user:
                return error("Invalid or expired session.", 401)
            if admin and user.get("role") != "admin":
                return error("Administrator access required.", 403)
            g.user = user
            return fn(*args, **kwargs)
        return wrapped
    return decorate


def make_token(user):
    expiry = now() + timedelta(hours=current_app.config["JWT_EXPIRES_HOURS"])
    return jwt.encode({"sub": str(user["_id"]), "role": user.get("role", "customer"), "exp": expiry}, current_app.config["JWT_SECRET"], algorithm="HS256")


def register_routes(app):
    @app.before_request
    def setup_db():
        if getattr(app, "_db_ready", False):
            return
        try:
            db = mongo.db
            # The earlier email/password version created this unique index. Remove it so new
            # register-number accounts can be inserted without an email field.
            if "email_1" in db.users.index_information():
                db.users.drop_index("email_1")
            db.users.create_index([("register_number", ASCENDING)], unique=True, sparse=True)
            db.foods.create_index([("category_id", ASCENDING)])
            db.foods.create_index([("food_name", "text"), ("description", "text")])
            db.orders.create_index([("user_id", ASCENDING), ("order_date", DESCENDING)])
            db.orders.create_index([("order_status", ASCENDING)])
            db.categories.create_index([("category_name", ASCENDING)], unique=True)
            if db.categories.count_documents({}) == 0:
                names = sorted({item["category_name"] for item in SAMPLE_FOODS})
                ids = {name: db.categories.insert_one({"category_name": name, "description": f"Freshly prepared {name.lower()} favourites."}).inserted_id for name in names}
                db.foods.insert_many([{**{k: v for k, v in item.items() if k != "category_name"}, "category_id": ids[item["category_name"]], "availability": True, "created_at": now()} for item in SAMPLE_FOODS])
            app._db_ready = True
        except Exception:
            app.logger.exception("Database initialization failed")
            return error("Database unavailable. Check the backend database configuration.", 503)

    @app.post("/api/auth/register")
    def register():
        data = request.get_json(silent=True) or {}
        name = str(data.get("name", "")).strip()
        register_number = str(data.get("register_number", "")).strip().upper()
        phone = str(data.get("phone", "")).strip()
        if not name or not register_number:
            return error("Enter your name and register number.")
        if phone and not re.fullmatch(r"[+\d()\- ]{7,20}", phone):
            return error("Enter a valid phone number.")
        try:
            user = {"name": name, "register_number": register_number, "phone": phone, "role": "customer", "created_at": now()}
            user["_id"] = mongo.db.users.insert_one(user).inserted_id
            return jsonify(token=make_token(user), user={"id": str(user["_id"]), "name": name, "register_number": register_number, "phone": phone, "role": "customer"}), 201
        except Exception:
            return error("This register number is already registered.", 409)

    @app.post("/api/auth/login")
    def login():
        data = request.get_json(silent=True) or {}
        register_number = str(data.get("register_number", "")).strip().upper()
        name = str(data.get("name", "")).strip()
        user = mongo.db.users.find_one({"register_number": register_number, "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}) if register_number and name else None
        if not user:
            return error("Register number and name do not match.", 401)
        return jsonify(token=make_token(user), user={"id": str(user["_id"]), "name": user["name"], "register_number": user.get("register_number", ""), "phone": user.get("phone", ""), "role": user["role"]})

    @app.post("/api/auth/logout")
    def logout():
        return jsonify(message="Signed out. Remove the local session token.")

    @app.route("/api/auth/profile", methods=["GET", "PATCH"])
    @token_required()
    def profile():
        if request.method == "PATCH":
            data = request.get_json(silent=True) or {}
            update = {}
            if "name" in data and len(str(data["name"]).strip()) >= 2:
                update["name"] = str(data["name"]).strip()
            if "phone" in data and (not data["phone"] or re.fullmatch(r"[+\d()\- ]{7,20}", str(data["phone"]))):
                update["phone"] = str(data["phone"]).strip()
            if update:
                mongo.db.users.update_one({"_id": g.user["_id"]}, {"$set": update})
                g.user.update(update)
        return jsonify(user={"id": str(g.user["_id"]), "name": g.user["name"], "register_number": g.user.get("register_number", ""), "phone": g.user.get("phone", ""), "role": g.user["role"]})

    @app.get("/api/foods")
    def foods():
        query, category = request.args.get("q", "").strip(), request.args.get("category", "").strip()
        criteria = {}
        if request.args.get("all") != "true":
            criteria["availability"] = True
        if category:
            cat = mongo.db.categories.find_one({"$or": [{"_id": valid_object_id(category)}, {"category_name": {"$regex": f"^{re.escape(category)}$", "$options": "i"}}]})
            if not cat:
                return jsonify(items=[])
            criteria["category_id"] = cat["_id"]
        if query:
            criteria["$or"] = [{"food_name": {"$regex": re.escape(query), "$options": "i"}}, {"description": {"$regex": re.escape(query), "$options": "i"}}]
        result = []
        for item in mongo.db.foods.find(criteria).sort("created_at", DESCENDING):
            cat = mongo.db.categories.find_one({"_id": item["category_id"]})
            result.append({**json_doc(item), "category": cat.get("category_name", "Menu") if cat else "Menu", "category_id": str(item["category_id"])})
        return jsonify(items=result)

    @app.get("/api/foods/<food_id>")
    def food_detail(food_id):
        oid = valid_object_id(food_id)
        item = mongo.db.foods.find_one({"_id": oid}) if oid else None
        if not item:
            return error("Food item not found.", 404)
        cat = mongo.db.categories.find_one({"_id": item["category_id"]})
        return jsonify(item={**json_doc(item), "category": cat.get("category_name", "Menu") if cat else "Menu", "category_id": str(item["category_id"])})

    @app.get("/api/categories")
    def categories():
        return jsonify(items=[json_doc(c) for c in mongo.db.categories.find().sort("category_name", ASCENDING)])

    def cart_for(user_id):
        cart = mongo.db.carts.find_one({"user_id": user_id})
        return cart or {"user_id": user_id, "items": []}

    def enrich_cart(cart):
        items, total = [], 0
        for line in cart.get("items", []):
            food = mongo.db.foods.find_one({"_id": line["food_id"]})
            if food:
                qty = int(line["quantity"])
                item = {**json_doc(food), "category_id": str(food["category_id"]), "quantity": qty, "line_total": food["price"] * qty}
                items.append(item)
                total += item["line_total"]
        return {"items": items, "total": total}

    @app.get("/api/cart")
    @token_required()
    def get_cart():
        return jsonify(cart=enrich_cart(cart_for(g.user["_id"])))

    @app.post("/api/cart")
    @token_required()
    def add_cart():
        data = request.get_json(silent=True) or {}
        food_id, qty = valid_object_id(data.get("food_id")), data.get("quantity", 1)
        if not food_id or not isinstance(qty, int) or qty < 1 or qty > 50:
            return error("Choose a valid item and quantity (1–50).")
        food = mongo.db.foods.find_one({"_id": food_id, "availability": True})
        if not food:
            return error("This item is currently unavailable.", 404)
        cart = cart_for(g.user["_id"])
        found = next((line for line in cart["items"] if line["food_id"] == food_id), None)
        if found:
            found["quantity"] = min(50, found["quantity"] + qty)
        else:
            cart["items"].append({"food_id": food_id, "quantity": qty})
        mongo.db.carts.update_one({"user_id": g.user["_id"]}, {"$set": {"items": cart["items"], "updated_at": now()}}, upsert=True)
        return jsonify(cart=enrich_cart(cart))

    @app.patch("/api/cart/<food_id>")
    @token_required()
    def update_cart(food_id):
        oid, data = valid_object_id(food_id), request.get_json(silent=True) or {}
        qty = data.get("quantity")
        if not oid or not isinstance(qty, int) or qty < 1 or qty > 50:
            return error("Quantity must be between 1 and 50.")
        cart = cart_for(g.user["_id"])
        for line in cart["items"]:
            if line["food_id"] == oid:
                line["quantity"] = qty
        mongo.db.carts.update_one({"user_id": g.user["_id"]}, {"$set": {"items": cart["items"], "updated_at": now()}}, upsert=True)
        return jsonify(cart=enrich_cart(cart))

    @app.delete("/api/cart/<food_id>")
    @token_required()
    def remove_cart(food_id):
        oid = valid_object_id(food_id)
        cart = cart_for(g.user["_id"])
        cart["items"] = [line for line in cart["items"] if line["food_id"] != oid]
        mongo.db.carts.update_one({"user_id": g.user["_id"]}, {"$set": {"items": cart["items"], "updated_at": now()}}, upsert=True)
        return jsonify(cart=enrich_cart(cart))

    @app.delete("/api/cart")
    @token_required()
    def clear_cart():
        mongo.db.carts.update_one({"user_id": g.user["_id"]}, {"$set": {"items": [], "updated_at": now()}}, upsert=True)
        return jsonify(cart={"items": [], "total": 0})

    @app.post("/api/orders")
    @token_required()
    def place_order():
        data, cart = request.get_json(silent=True) or {}, cart_for(g.user["_id"])
        method = data.get("payment_method", "Pay at counter")
        if method not in ["Pay at counter", "UPI"]:
            return error("Select a supported payment method.")
        if not cart["items"]:
            return error("Your cart is empty.")
        lines, total = [], 0
        for line in cart["items"]:
            food = mongo.db.foods.find_one({"_id": line["food_id"], "availability": True})
            if not food:
                return error("A cart item is unavailable. Refresh your cart and try again.", 409)
            qty = int(line["quantity"])
            lines.append({"food_id": food["_id"], "food_name": food["food_name"], "price": food["price"], "image": food.get("image", ""), "quantity": qty})
            total += food["price"] * qty
        order = {"user_id": g.user["_id"], "items": lines, "total_amount": total, "payment_method": method, "payment_status": "Pay at counter" if method == "Pay at counter" else "Pending", "order_status": "Pending", "order_date": now()}
        order["_id"] = mongo.db.orders.insert_one(order).inserted_id
        mongo.db.carts.update_one({"user_id": g.user["_id"]}, {"$set": {"items": [], "updated_at": now()}}, upsert=True)
        return jsonify(order=json_doc(order)), 201

    @app.get("/api/orders")
    @token_required()
    def my_orders():
        return jsonify(items=[json_doc(o) for o in mongo.db.orders.find({"user_id": g.user["_id"]}).sort("order_date", DESCENDING)])

    @app.post("/api/contact")
    def contact():
        data = request.get_json(silent=True) or {}
        fields = {key: str(data.get(key, "")).strip() for key in ["name", "email", "subject", "message"]}
        if any(not value for value in fields.values()) or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", fields["email"]):
            return error("Please complete all fields with a valid email address.")
        mongo.db.contact_messages.insert_one({**fields, "created_at": now()})
        return jsonify(message="Thanks for reaching out. Your message has been received."), 201

    @app.get("/api/admin/dashboard")
    @token_required(admin=True)
    def dashboard():
        db = mongo.db
        completed = list(db.orders.find({"order_status": {"$ne": "Cancelled"}}, {"total_amount": 1, "order_status": 1}))
        recent = [json_doc(o) for o in db.orders.find().sort("order_date", DESCENDING).limit(6)]
        return jsonify(stats={"users": db.users.count_documents({"role": "customer"}), "foods": db.foods.count_documents({}), "orders": db.orders.count_documents({}), "sales": sum(o.get("total_amount", 0) for o in completed)}, recent_orders=recent)

    @app.route("/api/admin/foods", methods=["GET", "POST"])
    @token_required(admin=True)
    def admin_foods():
        if request.method == "GET":
            return jsonify(items=[json_doc(i) | {"category_id": str(i["category_id"])} for i in mongo.db.foods.find().sort("created_at", DESCENDING)])
        data = request.get_json(silent=True) or {}
        name, description = str(data.get("food_name", "")).strip(), str(data.get("description", "")).strip()
        try:
            price = float(data.get("price"))
            cat = mongo.db.categories.find_one({"_id": valid_object_id(data.get("category_id"))})
        except (ValueError, TypeError):
            price, cat = 0, None
        if len(name) < 2 or not description or price <= 0 or not cat:
            return error("Provide a name, description, positive price, and valid category.")
        item = {"food_name": name, "description": description, "price": price, "image": str(data.get("image", "")), "category_id": cat["_id"], "availability": bool(data.get("availability", True)), "created_at": now()}
        item["_id"] = mongo.db.foods.insert_one(item).inserted_id
        return jsonify(item=json_doc(item) | {"category_id": str(cat["_id"])}), 201

    @app.route("/api/admin/foods/<food_id>", methods=["PATCH", "DELETE"])
    @token_required(admin=True)
    def admin_food_detail(food_id):
        oid = valid_object_id(food_id)
        item = mongo.db.foods.find_one({"_id": oid}) if oid else None
        if not item:
            return error("Food item not found.", 404)
        if request.method == "DELETE":
            mongo.db.foods.delete_one({"_id": oid})
            return jsonify(message="Food item removed.")
        data, update = request.get_json(silent=True) or {}, {}
        for key in ["food_name", "description", "image"]:
            if key in data:
                update[key] = str(data[key]).strip()
        if "price" in data:
            try:
                update["price"] = float(data["price"])
                if update["price"] <= 0:
                    return error("Price must be greater than zero.")
            except (ValueError, TypeError):
                return error("Enter a valid price.")
        if "availability" in data:
            update["availability"] = bool(data["availability"])
        if "category_id" in data:
            cat_id = valid_object_id(data["category_id"])
            if not cat_id or not mongo.db.categories.find_one({"_id": cat_id}):
                return error("Choose a valid category.")
            update["category_id"] = cat_id
        mongo.db.foods.update_one({"_id": oid}, {"$set": update})
        return jsonify(item=json_doc(mongo.db.foods.find_one({"_id": oid})) | {"category_id": str(update.get("category_id", item["category_id"]))})

    @app.route("/api/admin/categories", methods=["GET", "POST"])
    @token_required(admin=True)
    def admin_categories():
        if request.method == "GET":
            return jsonify(items=[json_doc(c) for c in mongo.db.categories.find().sort("category_name", ASCENDING)])
        data = request.get_json(silent=True) or {}
        name = str(data.get("category_name", "")).strip()
        if len(name) < 2:
            return error("Category name must have at least two characters.")
        try:
            oid = mongo.db.categories.insert_one({"category_name": name, "description": str(data.get("description", "")).strip()}).inserted_id
            return jsonify(item=json_doc(mongo.db.categories.find_one({"_id": oid}))), 201
        except Exception:
            return error("That category already exists.", 409)

    @app.get("/api/admin/users")
    @token_required(admin=True)
    def admin_users():
        users = [{"id": str(u["_id"]), "name": u["name"], "register_number": u.get("register_number", ""), "phone": u.get("phone", ""), "role": u["role"], "created_at": u["created_at"]} for u in mongo.db.users.find().sort("created_at", DESCENDING)]
        return jsonify(items=users)

    @app.get("/api/admin/orders")
    @token_required(admin=True)
    def admin_orders():
        result = []
        for order in mongo.db.orders.find().sort("order_date", DESCENDING).limit(100):
            user = mongo.db.users.find_one({"_id": order["user_id"]}, {"name": 1, "email": 1})
            result.append(json_doc(order) | {"customer": user.get("name", "Customer") if user else "Customer", "email": user.get("email", "") if user else ""})
        return jsonify(items=result)

    @app.patch("/api/admin/orders/<order_id>/status")
    @token_required(admin=True)
    def update_order(order_id):
        oid, data = valid_object_id(order_id), request.get_json(silent=True) or {}
        status = data.get("order_status")
        if status not in STATUSES:
            return error("Choose a valid order status.")
        result = mongo.db.orders.update_one({"_id": oid}, {"$set": {"order_status": status}}) if oid else None
        if not result or result.matched_count == 0:
            return error("Order not found.", 404)
        return jsonify(order=json_doc(mongo.db.orders.find_one({"_id": oid})))
