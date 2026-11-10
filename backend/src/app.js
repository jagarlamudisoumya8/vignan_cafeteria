const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const {
  User,
  Category,
  Food,
  Cart,
  Order,
  ContactMessage,
} = require('./models');

const STATUSES = [
  'Pending',
  'Confirmed',
  'Preparing',
  'Ready for Pickup',
  'Completed',
  'Cancelled',
];

const SAMPLE_FOODS = [
  { food_name: 'Masala Dosa', description: 'Crisp golden dosa with potato masala, coconut chutney and sambar.', price: 65, category_name: 'Breakfast', image: 'https://images.unsplash.com/photo-1668236543090-82eba5ee5976?auto=format&fit=crop&w=900&q=85' },
  { food_name: 'Paneer Rice Bowl', description: 'Steamed rice, smoky paneer tikka, fresh greens and mint yogurt.', price: 120, category_name: 'Lunch', image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=85' },
  { food_name: 'Veggie Club Sandwich', description: 'Toasted multigrain bread layered with garden vegetables and house spread.', price: 85, category_name: 'Snacks', image: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?auto=format&fit=crop&w=900&q=85' },
  { food_name: 'Filter Coffee', description: 'Rich South Indian filter coffee, freshly brewed and served hot.', price: 30, category_name: 'Drinks', image: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=900&q=85' },
  { food_name: 'Classic Veg Burger', description: 'Crispy veggie patty, lettuce, tomato and tangy house sauce.', price: 95, category_name: 'Snacks', image: 'https://images.unsplash.com/photo-1520072959219-c595dc870360?auto=format&fit=crop&w=900&q=85' },
  { food_name: 'Fresh Fruit Bowl', description: 'A bright mix of seasonal fruit, prepared fresh each morning.', price: 70, category_name: 'Breakfast', image: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=900&q=85' },
];

const PHONE_PATTERN = /^[+\d()\- ]{7,20}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    register_number: user.register_number || '',
    phone: user.phone || '',
    role: user.role,
  };
}

function plainDocument(document) {
  return document.toObject({
    versionKey: false,
    transform(_doc, result) {
      result._id = String(result._id);
      for (const key of ['user_id', 'food_id', 'category_id']) {
        if (result[key]) result[key] = String(result[key]);
      }
      if (Array.isArray(result.items)) {
        result.items = result.items.map(item => ({
          ...item,
          ...(item.food_id ? { food_id: String(item.food_id) } : {}),
        }));
      }
      return result;
    },
  });
}

function validObjectId(value) {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function errorResponse(res, message, status = 400) {
  return res.status(status).json({ error: message });
}

function requireJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set to a random value of at least 32 characters.');
  }
  return secret;
}

function makeToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role },
    requireJwtSecret(),
    { algorithm: 'HS256', expiresIn: `${Number(process.env.JWT_EXPIRES_HOURS) || 24}h` },
  );
}

function authenticate(admin = false) {
  return async (req, res, next) => {
    const header = req.get('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) return errorResponse(res, 'Authentication required.', 401);

    let payload;
    try {
      payload = jwt.verify(match[1], requireJwtSecret(), { algorithms: ['HS256'] });
    } catch {
      return errorResponse(res, 'Invalid or expired session.', 401);
    }

    const userId = validObjectId(payload.sub);
    const user = userId ? await User.findById(userId) : null;
    if (!user) return errorResponse(res, 'Invalid or expired session.', 401);
    if (admin && user.role !== 'admin') {
      return errorResponse(res, 'Administrator access required.', 403);
    }
    req.user = user;
    return next();
  };
}

async function getCart(userId) {
  return (await Cart.findOne({ user_id: userId })) || new Cart({ user_id: userId, items: [] });
}

async function enrichCart(cart) {
  const ids = cart.items.map(item => item.food_id);
  const foods = ids.length ? await Food.find({ _id: { $in: ids } }) : [];
  const byId = new Map(foods.map(food => [String(food._id), food]));
  const items = [];
  let total = 0;
  for (const line of cart.items) {
    const food = byId.get(String(line.food_id));
    if (!food) continue;
    const quantity = line.quantity;
    const lineTotal = food.price * quantity;
    items.push({
      ...plainDocument(food),
      quantity,
      line_total: lineTotal,
    });
    total += lineTotal;
  }
  return { items, total };
}

function createApp() {
  const app = express();
  const origins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map(origin => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || origins.includes(origin));
    },
  }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    const connected = mongoose.connection.readyState === 1;
    return res.status(connected ? 200 : 503).json({
      status: connected ? 'ok' : 'degraded',
      database: connected ? 'connected' : 'unavailable',
    });
  });

  app.post('/api/auth/register', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const registerNumber = String(req.body?.register_number || '').trim().toUpperCase();
    const phone = String(req.body?.phone || '').trim();
    if (!name || !registerNumber) {
      return errorResponse(res, 'Enter your name and register number.');
    }
    if (phone && !PHONE_PATTERN.test(phone)) {
      return errorResponse(res, 'Enter a valid phone number.');
    }
    const user = await User.create({
      name,
      register_number: registerNumber,
      phone,
      role: 'customer',
    });
    return res.status(201).json({ token: makeToken(user), user: publicUser(user) });
  });

  app.post('/api/auth/login', async (req, res) => {
    const registerNumber = String(req.body?.register_number || '').trim().toUpperCase();
    const name = String(req.body?.name || '').trim();
    const user = registerNumber && name
      ? await User.findOne({
        register_number: registerNumber,
        name: new RegExp(`^${escapeRegex(name)}$`, 'i'),
      })
      : null;
    if (!user) return errorResponse(res, 'Register number and name do not match.', 401);
    return res.json({ token: makeToken(user), user: publicUser(user) });
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.json({ message: 'Signed out. Remove the local session token.' });
  });

  app.route('/api/auth/profile')
    .get(authenticate(), (req, res) => res.json({ user: publicUser(req.user) }))
    .patch(authenticate(), async (req, res) => {
      const update = {};
      if (req.body?.name !== undefined) {
        const name = String(req.body.name).trim();
        if (name.length < 2) return errorResponse(res, 'Name must have at least two characters.');
        update.name = name;
      }
      if (req.body?.phone !== undefined) {
        const phone = String(req.body.phone).trim();
        if (phone && !PHONE_PATTERN.test(phone)) return errorResponse(res, 'Enter a valid phone number.');
        update.phone = phone;
      }
      if (Object.keys(update).length) await User.updateOne({ _id: req.user._id }, { $set: update });
      Object.assign(req.user, update);
      return res.json({ user: publicUser(req.user) });
    });

  app.get('/api/foods', async (req, res) => {
    const query = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();
    const criteria = req.query.all === 'true' ? {} : { availability: true };
    if (category) {
      const categoryId = validObjectId(category);
      const filter = categoryId
        ? { $or: [{ _id: categoryId }, { category_name: new RegExp(`^${escapeRegex(category)}$`, 'i') }] }
        : { category_name: new RegExp(`^${escapeRegex(category)}$`, 'i') };
      const found = await Category.findOne(filter);
      if (!found) return res.json({ items: [] });
      criteria.category_id = found._id;
    }
    if (query) {
      criteria.$or = [
        { food_name: new RegExp(escapeRegex(query), 'i') },
        { description: new RegExp(escapeRegex(query), 'i') },
      ];
    }
    const foods = await Food.find(criteria).sort({ created_at: -1 });
    const categories = await Category.find({
      _id: { $in: foods.map(food => food.category_id) },
    });
    const categoryNames = new Map(categories.map(item => [String(item._id), item.category_name]));
    return res.json({
      items: foods.map(food => ({
        ...plainDocument(food),
        category: categoryNames.get(String(food.category_id)) || 'Menu',
      })),
    });
  });

  app.get('/api/foods/:foodId', async (req, res) => {
    const id = validObjectId(req.params.foodId);
    const food = id ? await Food.findById(id) : null;
    if (!food) return errorResponse(res, 'Food item not found.', 404);
    const category = await Category.findById(food.category_id);
    return res.json({
      item: { ...plainDocument(food), category: category?.category_name || 'Menu' },
    });
  });

  app.get('/api/categories', async (_req, res) => {
    const items = await Category.find().sort({ category_name: 1 });
    return res.json({ items: items.map(plainDocument) });
  });

  app.get('/api/cart', authenticate(), async (req, res) => {
    const cart = await getCart(req.user._id);
    return res.json({ cart: await enrichCart(cart) });
  });

  app.post('/api/cart', authenticate(), async (req, res) => {
    const foodId = validObjectId(req.body?.food_id);
    const quantity = req.body?.quantity === undefined ? 1 : req.body.quantity;
    if (!foodId || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return errorResponse(res, 'Choose a valid item and quantity (1–50).');
    }
    const food = await Food.findOne({ _id: foodId, availability: true });
    if (!food) return errorResponse(res, 'This item is currently unavailable.', 404);
    const cart = await getCart(req.user._id);
    const line = cart.items.find(item => String(item.food_id) === String(foodId));
    if (line) line.quantity = Math.min(50, line.quantity + quantity);
    else cart.items.push({ food_id: foodId, quantity });
    cart.updated_at = new Date();
    await cart.save();
    return res.json({ cart: await enrichCart(cart) });
  });

  app.patch('/api/cart/:foodId', authenticate(), async (req, res) => {
    const foodId = validObjectId(req.params.foodId);
    const quantity = req.body?.quantity;
    if (!foodId || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return errorResponse(res, 'Quantity must be between 1 and 50.');
    }
    const cart = await getCart(req.user._id);
    const line = cart.items.find(item => String(item.food_id) === String(foodId));
    if (line) {
      line.quantity = quantity;
      cart.updated_at = new Date();
      await cart.save();
    }
    return res.json({ cart: await enrichCart(cart) });
  });

  app.delete('/api/cart/:foodId', authenticate(), async (req, res) => {
    const foodId = validObjectId(req.params.foodId);
    if (!foodId) return errorResponse(res, 'Choose a valid item.');
    const cart = await getCart(req.user._id);
    cart.items = cart.items.filter(item => String(item.food_id) !== String(foodId));
    cart.updated_at = new Date();
    await cart.save();
    return res.json({ cart: await enrichCart(cart) });
  });

  app.delete('/api/cart', authenticate(), async (req, res) => {
    await Cart.updateOne(
      { user_id: req.user._id },
      { $set: { items: [], updated_at: new Date() } },
      { upsert: true },
    );
    return res.json({ cart: { items: [], total: 0 } });
  });

  app.post('/api/orders', authenticate(), async (req, res) => {
    const method = req.body?.payment_method || 'Pay at counter';
    if (!['Pay at counter', 'UPI'].includes(method)) {
      return errorResponse(res, 'Select a supported payment method.');
    }
    const cart = await getCart(req.user._id);
    if (!cart.items.length) return errorResponse(res, 'Your cart is empty.');

    const lines = [];
    let total = 0;
    for (const line of cart.items) {
      const food = await Food.findOne({ _id: line.food_id, availability: true });
      if (!food) return errorResponse(res, 'A cart item is unavailable. Refresh your cart and try again.', 409);
      lines.push({
        food_id: food._id,
        food_name: food.food_name,
        price: food.price,
        image: food.image || '',
        quantity: line.quantity,
      });
      total += food.price * line.quantity;
    }

    const order = await Order.create({
      user_id: req.user._id,
      items: lines,
      total_amount: total,
      payment_method: method,
      payment_status: method === 'Pay at counter' ? 'Pay at counter' : 'Pending',
      order_status: 'Pending',
    });
    cart.items = [];
    cart.updated_at = new Date();
    await cart.save();
    return res.status(201).json({ order: plainDocument(order) });
  });

  app.get('/api/orders', authenticate(), async (req, res) => {
    const items = await Order.find({ user_id: req.user._id }).sort({ order_date: -1 });
    return res.json({ items: items.map(plainDocument) });
  });

  app.post('/api/contact', async (req, res) => {
    const fields = Object.fromEntries(
      ['name', 'email', 'subject', 'message']
        .map(key => [key, String(req.body?.[key] || '').trim()]),
    );
    if (Object.values(fields).some(value => !value) || !EMAIL_PATTERN.test(fields.email)) {
      return errorResponse(res, 'Please complete all fields with a valid email address.');
    }
    await ContactMessage.create(fields);
    return res.status(201).json({ message: 'Thanks for reaching out. Your message has been received.' });
  });

  app.get('/api/admin/dashboard', authenticate(true), async (_req, res) => {
    const [users, foods, orders, recentOrders, sales] = await Promise.all([
      User.countDocuments({ role: 'customer' }),
      Food.countDocuments(),
      Order.countDocuments(),
      Order.find().sort({ order_date: -1 }).limit(6),
      Order.aggregate([
        { $match: { order_status: { $ne: 'Cancelled' } } },
        { $group: { _id: null, total: { $sum: '$total_amount' } } },
      ]),
    ]);
    return res.json({
      stats: { users, foods, orders, sales: sales[0]?.total || 0 },
      recent_orders: recentOrders.map(plainDocument),
    });
  });

  app.route('/api/admin/foods')
    .get(authenticate(true), async (_req, res) => {
      const items = await Food.find().sort({ created_at: -1 });
      return res.json({ items: items.map(plainDocument) });
    })
    .post(authenticate(true), async (req, res) => {
      const name = String(req.body?.food_name || '').trim();
      const description = String(req.body?.description || '').trim();
      const price = Number(req.body?.price);
      const categoryId = validObjectId(req.body?.category_id);
      const category = categoryId ? await Category.findById(categoryId) : null;
      if (name.length < 2 || !description || !Number.isFinite(price) || price <= 0 || !category) {
        return errorResponse(res, 'Provide a name, description, positive price, and valid category.');
      }
      const food = await Food.create({
        food_name: name,
        description,
        price,
        image: String(req.body?.image || ''),
        category_id: category._id,
        availability: req.body?.availability === undefined ? true : Boolean(req.body.availability),
      });
      return res.status(201).json({ item: plainDocument(food) });
    });

  app.route('/api/admin/foods/:foodId')
    .patch(authenticate(true), async (req, res) => {
      const id = validObjectId(req.params.foodId);
      const food = id ? await Food.findById(id) : null;
      if (!food) return errorResponse(res, 'Food item not found.', 404);

      const update = {};
      for (const key of ['food_name', 'description', 'image']) {
        if (req.body?.[key] !== undefined) update[key] = String(req.body[key]).trim();
      }
      if ('food_name' in update && update.food_name.length < 2) {
        return errorResponse(res, 'Food name must have at least two characters.');
      }
      if ('description' in update && !update.description) {
        return errorResponse(res, 'Description is required.');
      }
      if (req.body?.price !== undefined) {
        const price = Number(req.body.price);
        if (!Number.isFinite(price) || price <= 0) return errorResponse(res, 'Enter a valid price.');
        update.price = price;
      }
      if (req.body?.availability !== undefined) update.availability = Boolean(req.body.availability);
      if (req.body?.category_id !== undefined) {
        const categoryId = validObjectId(req.body.category_id);
        if (!categoryId || !await Category.exists({ _id: categoryId })) {
          return errorResponse(res, 'Choose a valid category.');
        }
        update.category_id = categoryId;
      }
      Object.assign(food, update);
      await food.save();
      return res.json({ item: plainDocument(food) });
    })
    .delete(authenticate(true), async (req, res) => {
      const id = validObjectId(req.params.foodId);
      const food = id ? await Food.findByIdAndDelete(id) : null;
      if (!food) return errorResponse(res, 'Food item not found.', 404);
      return res.json({ message: 'Food item removed.' });
    });

  app.route('/api/admin/categories')
    .get(authenticate(true), async (_req, res) => {
      const items = await Category.find().sort({ category_name: 1 });
      return res.json({ items: items.map(plainDocument) });
    })
    .post(authenticate(true), async (req, res) => {
      const name = String(req.body?.category_name || '').trim();
      if (name.length < 2) return errorResponse(res, 'Category name must have at least two characters.');
      try {
        const item = await Category.create({
          category_name: name,
          description: String(req.body?.description || '').trim(),
        });
        return res.status(201).json({ item: plainDocument(item) });
      } catch (error) {
        if (error.code === 11000) return errorResponse(res, 'That category already exists.', 409);
        throw error;
      }
    });

  app.get('/api/admin/users', authenticate(true), async (_req, res) => {
    const users = await User.find().sort({ created_at: -1 });
    return res.json({
      items: users.map(user => ({
        ...publicUser(user),
        created_at: user.created_at,
      })),
    });
  });

  app.get('/api/admin/orders', authenticate(true), async (_req, res) => {
    const orders = await Order.find().sort({ order_date: -1 }).limit(100);
    const users = await User.find({
      _id: { $in: orders.map(order => order.user_id) },
    }).select('name');
    const userNames = new Map(users.map(user => [String(user._id), user.name]));
    return res.json({
      items: orders.map(order => ({
        ...plainDocument(order),
        customer: userNames.get(String(order.user_id)) || 'Customer',
        email: '',
      })),
    });
  });

  app.patch('/api/admin/orders/:orderId/status', authenticate(true), async (req, res) => {
    const id = validObjectId(req.params.orderId);
    const status = req.body?.order_status;
    if (!STATUSES.includes(status)) return errorResponse(res, 'Choose a valid order status.');
    const order = id
      ? await Order.findByIdAndUpdate(id, { order_status: status }, { returnDocument: 'after' })
      : null;
    if (!order) return errorResponse(res, 'Order not found.', 404);
    return res.json({ order: plainDocument(order) });
  });

  app.use((_req, res) => errorResponse(res, 'Route not found.', 404));
  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      return errorResponse(res, 'Request body must be valid JSON.');
    }
    if (error.name === 'ValidationError' || error.name === 'CastError') {
      return errorResponse(res, 'The submitted data is invalid.');
    }
    if (error.code === 11000) {
      return errorResponse(res, 'This account is already registered.', 409);
    }
    console.error('Unhandled API error:', error);
    return errorResponse(res, 'An unexpected server error occurred.', 500);
  });

  return app;
}

async function initializeDatabase() {
  const usersCollection = User.collection;
  const indexes = await usersCollection.indexes().catch(error => {
    if (error.codeName === 'NamespaceNotFound') return [];
    throw error;
  });
  if (indexes.some(index => index.name === 'email_1')) {
    await usersCollection.dropIndex('email_1');
  }

  await Promise.all([User.init(), Category.init(), Food.init(), Cart.init(), Order.init(), ContactMessage.init()]);

  const categoriesByName = new Map();
  for (const name of new Set(SAMPLE_FOODS.map(food => food.category_name))) {
    const category = await Category.findOneAndUpdate(
      { category_name: name },
      { $setOnInsert: { description: `Freshly prepared ${name.toLowerCase()} favourites.` } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    categoriesByName.set(name, category._id);
  }
  if (await Food.countDocuments() === 0) {
    await Food.insertMany(SAMPLE_FOODS.map(({ category_name, ...food }) => ({
      ...food,
      category_id: categoriesByName.get(category_name),
    })));
  }
}

module.exports = { createApp, initializeDatabase, requireJwtSecret };
