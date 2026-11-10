const mongoose = require('mongoose');

const { Schema } = mongoose;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  register_number: { type: String, trim: true },
  phone: { type: String, default: '' },
  role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
  created_at: { type: Date, default: Date.now },
});
userSchema.index({ register_number: 1 }, { unique: true, sparse: true });

const categorySchema = new Schema({
  category_name: { type: String, required: true, trim: true, unique: true },
  description: { type: String, default: '' },
});

const foodSchema = new Schema({
  food_name: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  price: { type: Number, required: true, min: 0.01 },
  image: { type: String, default: '' },
  category_id: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
  availability: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
});
foodSchema.index({ category_id: 1 });
foodSchema.index({ food_name: 'text', description: 'text' });

const cartItemSchema = new Schema({
  food_id: { type: Schema.Types.ObjectId, ref: 'Food', required: true },
  quantity: { type: Number, required: true, min: 1, max: 50 },
}, { _id: false });

const cartSchema = new Schema({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  items: { type: [cartItemSchema], default: [] },
  updated_at: { type: Date, default: Date.now },
});

const orderItemSchema = new Schema({
  food_id: { type: Schema.Types.ObjectId, ref: 'Food', required: true },
  food_name: { type: String, required: true },
  price: { type: Number, required: true },
  image: { type: String, default: '' },
  quantity: { type: Number, required: true, min: 1 },
}, { _id: false });

const orderSchema = new Schema({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: { type: [orderItemSchema], required: true },
  total_amount: { type: Number, required: true, min: 0 },
  payment_method: { type: String, enum: ['Pay at counter', 'UPI'], required: true },
  payment_status: { type: String, required: true },
  order_status: {
    type: String,
    enum: ['Pending', 'Confirmed', 'Preparing', 'Ready for Pickup', 'Completed', 'Cancelled'],
    default: 'Pending',
  },
  order_date: { type: Date, default: Date.now },
});
orderSchema.index({ order_status: 1 });
orderSchema.index({ user_id: 1, order_date: -1 });

const contactMessageSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
});

module.exports = {
  User: mongoose.model('User', userSchema, 'users'),
  Category: mongoose.model('Category', categorySchema, 'categories'),
  Food: mongoose.model('Food', foodSchema, 'foods'),
  Cart: mongoose.model('Cart', cartSchema, 'carts'),
  Order: mongoose.model('Order', orderSchema, 'orders'),
  ContactMessage: mongoose.model('ContactMessage', contactMessageSchema, 'contact_messages'),
};
