const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// static client files
app.use(express.static(path.join(__dirname)));

const DB_PATH = path.join(__dirname, 'database.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads folder exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

// ================================================================
// HYBRID DATABASE CONNECTOR STATE & LOGIC
// ================================================================
let useMongoDB = false;
let dbClient = null;
let mongoDb = null;

// Helper to read local database (synchronous, fallback)
function readLocalDB() {
  if (!fs.existsSync(DB_PATH)) {
    // Default initial data
    const initialData = {
      config: {
        nombre: "El Garage de la Mascota",
        whatsapp: "5491126976444",
        instagram: "elgaragedelamascota",
        bienvenida: "Alimentos de calidad para perros y gatos. Precios directos, con atención personalizada.",
        adminUser: "admin",
        adminPass: "admin123"
      },
      categories: [
        { id: "cat_alimentos", nombre: "Alimentos", emoji: "🦴" },
        { id: "cat_ropa", nombre: "Ropa y Ponchos", emoji: "🧥" },
        { id: "cat_juguetes", nombre: "Juguetes", emoji: "🧸" },
        { id: "cat_accesorios", nombre: "Accesorios", emoji: "🎒" },
        { id: "cat_higiene", nombre: "Higiene", emoji: "🧼" },
        { id: "cat_medicacion", nombre: "Medicación", emoji: "💊" }
      ],
      products: []
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initialData, null, 2), 'utf8');
    return initialData;
  }
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("Error parsing database.json, returning empty structure", e);
    return { config: {}, categories: [], products: [] };
  }
}

// Helper to write local database
function writeLocalDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Initialize Database connection (runs on start)
async function initDB() {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    try {
      console.log("Intentando conectar a MongoDB Atlas...");
      dbClient = new MongoClient(uri);
      await dbClient.connect();
      mongoDb = dbClient.db();
      useMongoDB = true;
      console.log("=== Conectado exitosamente a MongoDB Atlas ===");

      const configColl = mongoDb.collection('config');
      const catsColl = mongoDb.collection('categories');
      const prodsColl = mongoDb.collection('products');

      const configCount = await configColl.countDocuments();
      const catsCount = await catsColl.countDocuments();
      const prodsCount = await prodsColl.countDocuments();

      const localData = readLocalDB();

      // Seed data from local database.json if collections are empty
      if (configCount === 0) {
        await configColl.insertOne(localData.config);
        console.log("-> Configuración inicializada en MongoDB.");
      }
      if (catsCount === 0) {
        await catsColl.insertMany(localData.categories);
        console.log("-> Categorías inicializadas en MongoDB.");
      }
      if (prodsCount === 0 && localData.products.length > 0) {
        await prodsColl.insertMany(localData.products);
        console.log("-> Productos inicializados en MongoDB.");
      }
    } catch (e) {
      console.error("Error al conectar a MongoDB. Usando base de datos local en JSON como fallback.", e);
      useMongoDB = false;
    }
  } else {
    console.log("MONGODB_URI no detectada. Iniciando servidor en modo local (JSON).");
    useMongoDB = false;
  }
}

// Async Database Accessors
async function getConfig() {
  if (useMongoDB) {
    const config = await mongoDb.collection('config').findOne({});
    return config || {};
  }
  return readLocalDB().config;
}

async function saveConfig(config) {
  if (useMongoDB) {
    const { _id, ...cleanConfig } = config;
    await mongoDb.collection('config').replaceOne({}, cleanConfig, { upsert: true });
    return;
  }
  const db = readLocalDB();
  db.config = config;
  writeLocalDB(db);
}

async function getCategories() {
  if (useMongoDB) {
    return await mongoDb.collection('categories').find({}).toArray();
  }
  return readLocalDB().categories;
}

async function saveCategory(cat) {
  if (useMongoDB) {
    const { _id, ...cleanCat } = cat;
    await mongoDb.collection('categories').replaceOne({ id: cat.id }, cleanCat, { upsert: true });
    return;
  }
  const db = readLocalDB();
  const index = db.categories.findIndex(c => c.id === cat.id);
  if (index === -1) {
    db.categories.push(cat);
  } else {
    db.categories[index] = cat;
  }
  writeLocalDB(db);
}

async function deleteCategory(id) {
  if (useMongoDB) {
    await mongoDb.collection('categories').deleteOne({ id: id });
    return;
  }
  const db = readLocalDB();
  const index = db.categories.findIndex(c => c.id === id);
  if (index !== -1) {
    db.categories.splice(index, 1);
    writeLocalDB(db);
  }
}

async function getProducts() {
  if (useMongoDB) {
    return await mongoDb.collection('products').find({}).toArray();
  }
  return readLocalDB().products;
}

async function saveProduct(prod) {
  if (useMongoDB) {
    const { _id, ...cleanProd } = prod;
    await mongoDb.collection('products').replaceOne({ id: prod.id }, cleanProd, { upsert: true });
    return;
  }
  const db = readLocalDB();
  const index = db.products.findIndex(p => p.id === prod.id);
  if (index === -1) {
    db.products.push(prod);
  } else {
    // Preserve base64 image if present and update doesn't override it
    if (db.products[index].localImage && !prod.localImage) {
      prod.localImage = db.products[index].localImage;
    }
    db.products[index] = prod;
  }
  writeLocalDB(db);
}

async function deleteProduct(id) {
  if (useMongoDB) {
    await mongoDb.collection('products').deleteOne({ id: id });
    return;
  }
  const db = readLocalDB();
  const index = db.products.findIndex(p => p.id === id);
  if (index !== -1) {
    db.products.splice(index, 1);
    writeLocalDB(db);
  }
}

async function getOrders() {
  if (useMongoDB) {
    return await mongoDb.collection('orders').find({}).toArray();
  }
  const db = readLocalDB();
  return db.orders || [];
}

async function saveOrder(order) {
  if (useMongoDB) {
    const { _id, ...cleanOrder } = order;
    await mongoDb.collection('orders').insertOne(cleanOrder);
    return;
  }
  const db = readLocalDB();
  if (!db.orders) db.orders = [];
  db.orders.push(order);
  writeLocalDB(db);
}

async function clearOrders() {
  if (useMongoDB) {
    await mongoDb.collection('orders').deleteMany({});
    return;
  }
  const db = readLocalDB();
  db.orders = [];
  writeLocalDB(db);
}

async function deleteOrder(id) {
  if (useMongoDB) {
    await mongoDb.collection('orders').deleteOne({ id: parseInt(id) });
    return;
  }
  const db = readLocalDB();
  if (db.orders) {
    db.orders = db.orders.filter(o => o.id !== parseInt(id));
    writeLocalDB(db);
  }
}

// Simple Admin Authorization Middleware
const ADMIN_TOKEN = 'secret-admin-session-token-123456';
function authorizeAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (token === ADMIN_TOKEN) {
      return next();
    }
  }
  return res.status(401).json({ error: 'No autorizado' });
}

// ================================================================
// API ROUTES
// ================================================================

// 1. Config
app.get('/api/config', async (req, res) => {
  try {
    const config = await getConfig();
    const publicConfig = { ...config };
    delete publicConfig.adminUser;
    delete publicConfig.adminPass;
    res.json(publicConfig);
  } catch (e) {
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
});

app.put('/api/config', authorizeAdmin, async (req, res) => {
  try {
    const config = await getConfig();
    const newConfig = req.body;
    
    const updated = {
      ...config,
      nombre: newConfig.nombre || config.nombre,
      whatsapp: newConfig.whatsapp || config.whatsapp,
      instagram: newConfig.instagram || config.instagram,
      bienvenida: newConfig.bienvenida || config.bienvenida,
      ajustePorcentaje: (newConfig.ajustePorcentaje !== undefined) ? parseFloat(newConfig.ajustePorcentaje) || 0 : (config.ajustePorcentaje || 0)
    };
    
    if (newConfig.adminUser) updated.adminUser = newConfig.adminUser;
    if (newConfig.adminPass) updated.adminPass = newConfig.adminPass;
    
    await saveConfig(updated);
    
    const publicConfig = { ...updated };
    delete publicConfig.adminUser;
    delete publicConfig.adminPass;
    res.json(publicConfig);
  } catch (e) {
    res.status(500).json({ error: 'Error al guardar configuración' });
  }
});

// 2. Categories
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await getCategories();
    res.json(categories);
  } catch (e) {
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
});

app.post('/api/categories', authorizeAdmin, async (req, res) => {
  try {
    const newCat = req.body;
    if (!newCat.id || !newCat.nombre) {
      return res.status(400).json({ error: 'id y nombre son requeridos' });
    }
    const categories = await getCategories();
    if (categories.some(c => c.id === newCat.id)) {
      return res.status(400).json({ error: 'La categoría ya existe' });
    }
    const cat = {
      id: newCat.id,
      nombre: newCat.nombre,
      emoji: newCat.emoji || '📦'
    };
    await saveCategory(cat);
    res.status(201).json(cat);
  } catch (e) {
    res.status(500).json({ error: 'Error al crear categoría' });
  }
});

app.put('/api/categories/:id', authorizeAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const categories = await getCategories();
    const cat = categories.find(c => c.id === id);
    if (!cat) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }
    const updated = {
      ...cat,
      nombre: req.body.nombre || cat.nombre,
      emoji: req.body.emoji || cat.emoji
    };
    await saveCategory(updated);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Error al actualizar categoría' });
  }
});

app.delete('/api/categories/:id', authorizeAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const categories = await getCategories();
    if (!categories.some(c => c.id === id)) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }
    await deleteCategory(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar categoría' });
  }
});

// 3. Products
app.get('/api/products', async (req, res) => {
  try {
    const products = await getProducts();
    const isAdminRequest = req.query.admin === 'true';
    
    if (isAdminRequest) {
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        if (token === ADMIN_TOKEN) {
          return res.json(products);
        }
      }
      return res.status(401).json({ error: 'No autorizado' });
    } else {
      const publicProducts = products
        .filter(p => !p.oculto)
        .map(p => {
          const pCopy = { ...p };
          delete pCopy.costo;
          delete pCopy.imageData; // hide base64 image data in listings
          return pCopy;
        });
      res.json(publicProducts);
    }
  } catch (e) {
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

app.post('/api/products', authorizeAdmin, async (req, res) => {
  try {
    const newProd = req.body;
    if (!newProd.nombre) {
      return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    
    const id = Date.now(); // Numeric ID
    const product = {
      id,
      nombre: newProd.nombre,
      marca: newProd.marca || '',
      cat: newProd.cat || '',
      emoji: newProd.emoji || '🐾',
      tipo: newProd.tipo || 'alimento',
      costo: parseFloat(newProd.costo) || 0,
      peso: parseFloat(newProd.peso) || 0,
      precioBolsa: parseFloat(newProd.precioBolsa) || 0,
      precioKg: parseFloat(newProd.precioKg) || 0,
      precioUnidad: parseFloat(newProd.precioUnidad) || 0,
      precioAnterior: parseFloat(newProd.precioAnterior) || 0,
      desc: newProd.desc || '',
      stock: newProd.stock !== undefined ? newProd.stock : true,
      talles: newProd.talles || {},
      promoEnabled: newProd.promoEnabled || false,
      promoQty: parseInt(newProd.promoQty) || 0,
      promoPrice: parseFloat(newProd.promoPrice) || 0,
      destacado: newProd.destacado || false,
      oculto: newProd.oculto || false,
      oferta: newProd.oferta || false,
      nuevo: newProd.nuevo || false,
      hasImage: false,
      imageUrl: newProd.imageUrl || ''
    };
    
    await saveProduct(product);
    res.status(201).json(product);
  } catch (e) {
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

app.put('/api/products/:id', authorizeAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const products = await getProducts();
    const current = products.find(p => p.id === id);
    if (!current) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    const update = req.body;
    const updated = {
      ...current,
      nombre: update.nombre !== undefined ? update.nombre : current.nombre,
      marca: update.marca !== undefined ? update.marca : current.marca,
      cat: update.cat !== undefined ? update.cat : current.cat,
      emoji: update.emoji !== undefined ? update.emoji : current.emoji,
      tipo: update.tipo !== undefined ? update.tipo : current.tipo,
      costo: update.costo !== undefined ? parseFloat(update.costo) || 0 : current.costo,
      peso: update.peso !== undefined ? parseFloat(update.peso) || 0 : current.peso,
      precioBolsa: update.precioBolsa !== undefined ? parseFloat(update.precioBolsa) || 0 : current.precioBolsa,
      precioKg: update.precioKg !== undefined ? parseFloat(update.precioKg) || 0 : current.precioKg,
      precioUnidad: update.precioUnidad !== undefined ? parseFloat(update.precioUnidad) || 0 : current.precioUnidad,
      precioAnterior: update.precioAnterior !== undefined ? parseFloat(update.precioAnterior) || 0 : current.precioAnterior,
      desc: update.desc !== undefined ? update.desc : current.desc,
      stock: update.stock !== undefined ? update.stock : current.stock,
      talles: update.talles !== undefined ? update.talles : current.talles,
      promoEnabled: update.promoEnabled !== undefined ? update.promoEnabled : current.promoEnabled,
      promoQty: update.promoQty !== undefined ? parseInt(update.promoQty) || 0 : current.promoQty,
      promoPrice: update.promoPrice !== undefined ? parseFloat(update.promoPrice) || 0 : current.promoPrice,
      destacado: update.destacado !== undefined ? update.destacado : current.destacado,
      oculto: update.oculto !== undefined ? update.oculto : current.oculto,
      oferta: update.oferta !== undefined ? update.oferta : current.oferta,
      nuevo: update.nuevo !== undefined ? update.nuevo : current.nuevo,
      hasImage: update.hasImage !== undefined ? update.hasImage : current.hasImage,
      imageUrl: update.imageUrl !== undefined ? update.imageUrl : current.imageUrl
    };
    
    // Preserve imageData if present in mongo
    if (current.imageData && update.hasImage !== false) {
      updated.imageData = current.imageData;
      updated.imageMimeType = current.imageMimeType;
    }
    
    await saveProduct(updated);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

app.delete('/api/products/:id', authorizeAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const products = await getProducts();
    const exists = products.some(p => p.id === id);
    if (!exists) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    if (!useMongoDB) {
      const files = fs.readdirSync(UPLOADS_DIR);
      const imageFile = files.find(f => f.startsWith(id + '.'));
      if (imageFile) {
        try {
          fs.unlinkSync(path.join(UPLOADS_DIR, imageFile));
        } catch (e) {
          console.error("Error deleting image file on product delete", e);
        }
      }
    }
    
    await deleteProduct(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// 4. File Upload (Multer) - Memory Storage for cloud compatibility
const storage = multer.memoryStorage();

const upload = multer({ 
  storage: storage,
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|webp|gif/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes!'));
    }
  }
});

app.post('/api/upload', authorizeAdmin, upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se subió ningún archivo' });
  }
  
  const productId = parseInt(req.body.productId);
  if (isNaN(productId)) {
    return res.status(400).json({ error: 'ID de producto no válido' });
  }
  
  if (useMongoDB) {
    try {
      const base64Str = req.file.buffer.toString('base64');
      const mimeType = req.file.mimetype;
      
      await mongoDb.collection('products').updateOne(
        { id: productId },
        { $set: { hasImage: true, imageData: base64Str, imageMimeType: mimeType } }
      );
      
      return res.json({ success: true });
    } catch (e) {
      console.error("Error al guardar archivo en MongoDB:", e);
      return res.status(500).json({ error: 'Error al guardar imagen en la base de datos' });
    }
  } else {
    // Local mode - write memory buffer to disk
    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const filename = productId + ext;
      const filePath = path.join(UPLOADS_DIR, filename);
      
      // Remove any existing image files with different extensions for this product
      if (fs.existsSync(UPLOADS_DIR)) {
        const files = fs.readdirSync(UPLOADS_DIR);
        files.forEach(f => {
          if (f.startsWith(productId + '.')) {
            try {
              fs.unlinkSync(path.join(UPLOADS_DIR, f));
            } catch (err) {
              console.error("Error deleting old file:", err);
            }
          }
        });
      }
      
      fs.writeFileSync(filePath, req.file.buffer);
      
      const products = await getProducts();
      const index = products.findIndex(p => p.id === productId);
      if (index !== -1) {
        const p = products[index];
        p.hasImage = true;
        await saveProduct(p);
      }
      res.json({ success: true, filename: filename });
    } catch (e) {
      console.error("Error al guardar archivo localmente:", e);
      res.status(500).json({ error: 'Error al guardar imagen localmente' });
    }
  }
});

// 5. Serve Product Images
app.get('/api/images/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  
  if (useMongoDB) {
    try {
      const prod = await mongoDb.collection('products').findOne({ id: id });
      if (prod && prod.hasImage && prod.imageData) {
        const imgBuffer = Buffer.from(prod.imageData, 'base64');
        res.contentType(prod.imageMimeType || 'image/jpeg');
        return res.send(imgBuffer);
      } else {
        return res.status(404).send('Imagen no encontrada');
      }
    } catch (e) {
      return res.status(500).send('Error al buscar la imagen');
    }
  } else {
    // Local mode
    const files = fs.readdirSync(UPLOADS_DIR);
    const imageFile = files.find(f => f.startsWith(id + '.'));
    
    if (imageFile) {
      res.sendFile(path.join(UPLOADS_DIR, imageFile));
    } else {
      res.status(404).send('Imagen no encontrada');
    }
  }
});

// 6. Delete Image
app.delete('/api/images/:id', authorizeAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  
  if (useMongoDB) {
    try {
      await mongoDb.collection('products').updateOne(
        { id: id },
        { $set: { hasImage: false }, $unset: { imageData: "", imageMimeType: "" } }
      );
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: 'No se pudo eliminar la imagen' });
    }
  } else {
    // Local mode
    const files = fs.readdirSync(UPLOADS_DIR);
    const imageFile = files.find(f => f.startsWith(id + '.'));
    
    if (imageFile) {
      try {
        fs.unlinkSync(path.join(UPLOADS_DIR, imageFile));
        
        const products = await getProducts();
        const index = products.findIndex(p => p.id === id);
        if (index !== -1) {
          const p = products[index];
          p.hasImage = false;
          await saveProduct(p);
        }
        return res.json({ success: true });
      } catch (e) {
        return res.status(500).json({ error: 'No se pudo eliminar la imagen' });
      }
    }
    res.status(404).json({ error: 'Imagen no encontrada' });
  }
});

// 6.5. Sales/Orders API
app.get('/api/orders', authorizeAdmin, async (req, res) => {
  try {
    const orders = await getOrders();
    res.json(orders);
  } catch (e) {
    res.status(500).json({ error: 'No se pudieron obtener las ventas' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const order = req.body;
    order.id = Date.now();
    order.fecha = new Date().toISOString();
    await saveOrder(order);
    res.json({ success: true, order });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo guardar la venta' });
  }
});

app.delete('/api/orders/all', authorizeAdmin, async (req, res) => {
  try {
    await clearOrders();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo limpiar el registro de ventas' });
  }
});

app.delete('/api/orders/:id', authorizeAdmin, async (req, res) => {
  try {
    await deleteOrder(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo eliminar la venta' });
  }
});

// 8. Visitas / Visitor Counter
app.post('/api/visits', async (req, res) => {
  try {
    const { visitorId } = req.body;
    if (!visitorId || typeof visitorId !== 'string') {
      return res.status(400).json({ error: 'visitorId requerido' });
    }
    
    if (useMongoDB) {
      const coll = mongoDb.collection('visits');
      await coll.updateOne(
        { _id: visitorId },
        { 
          $inc: { hits: 1 },
          $setOnInsert: { firstVisit: new Date() },
          $set: { lastVisit: new Date() }
        },
        { upsert: true }
      );
    } else {
      const db = readLocalDB();
      if (!db.visits) db.visits = [];
      let vis = db.visits.find(x => x.id === visitorId);
      if (vis) {
        vis.hits = (vis.hits || 0) + 1;
        vis.lastVisit = new Date();
      } else {
        db.visits.push({
          id: visitorId,
          hits: 1,
          firstVisit: new Date(),
          lastVisit: new Date()
        });
      }
      writeLocalDB(db);
    }
    res.json({ success: true });
  } catch (e) {
    console.error("Error logging visit:", e);
    res.status(500).json({ error: 'Error al registrar visita' });
  }
});

app.get('/api/visits/stats', authorizeAdmin, async (req, res) => {
  try {
    let totalVisits = 0;
    let uniqueVisitors = 0;
    
    if (useMongoDB) {
      const coll = mongoDb.collection('visits');
      uniqueVisitors = await coll.countDocuments();
      
      const agg = await coll.aggregate([
        { $group: { _id: null, totalHits: { $sum: "$hits" } } }
      ]).toArray();
      
      totalVisits = agg.length > 0 ? agg[0].totalHits : 0;
    } else {
      const db = readLocalDB();
      const visits = db.visits || [];
      uniqueVisitors = visits.length;
      totalVisits = visits.reduce((acc, x) => acc + (x.hits || 0), 0);
    }
    
    res.json({ totalVisits, uniqueVisitors });
  } catch (e) {
    console.error("Error getting visit stats:", e);
    res.status(500).json({ error: 'Error al obtener estadísticas de visitas' });
  }
});

app.post('/api/visits/exclude', authorizeAdmin, async (req, res) => {
  try {
    const { visitorId } = req.body;
    if (!visitorId || typeof visitorId !== 'string') {
      return res.status(400).json({ error: 'visitorId requerido' });
    }
    
    if (useMongoDB) {
      const coll = mongoDb.collection('visits');
      await coll.deleteOne({ _id: visitorId });
    } else {
      const db = readLocalDB();
      if (db.visits) {
        db.visits = db.visits.filter(x => x.id !== visitorId);
        writeLocalDB(db);
      }
    }
    res.json({ success: true });
  } catch (e) {
    console.error("Error excluding visits:", e);
    res.status(500).json({ error: 'Error al excluir visitas' });
  }
});

app.get('/api/reference-prices', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) {
      return res.status(400).json({ error: 'Query q requerida' });
    }
    
    const https = require('https');
    
    function fetchJson(url) {
      return new Promise((resolve, reject) => {
        const options = {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        };
        https.get(url, options, (apiRes) => {
          let data = '';
          apiRes.on('data', (chunk) => { data += chunk; });
          apiRes.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              resolve(null);
            }
          });
        }).on('error', (err) => {
          console.error(`Error fetching from ${url}:`, err);
          resolve(null);
        });
      });
    }

    let cleaned = q.toLowerCase()
      .replace(/\(id: \d+\)/gi, '')
      .replace(/alimento/gi, '')
      .replace(/poncho/gi, '')
      .replace(/ropa/gi, '')
      .replace(/juguete/gi, '')
      .replace(/accesorio/gi, '')
      .replace(/higiene/gi, '')
      .replace(/medicación/gi, '')
      .replace(/medicacion/gi, '')
      .trim();

    const mlUrl = `https://api.mercadolibre.com/sites/MLA/search?q=${encodeURIComponent(cleaned)}`;
    const puppisUrl = `https://www.puppis.com.ar/api/catalog_system/pub/products/search?ft=${encodeURIComponent(cleaned)}`;
    
    const [mlData, puppisData] = await Promise.all([
      fetchJson(mlUrl),
      fetchJson(puppisUrl).catch(() => null)
    ]);
    
    const response = {
      ml: null,
      puppis: null
    };

    if (mlData && mlData.results && mlData.results.length > 0) {
      const items = mlData.results.filter(x => x.price && x.price > 100);
      if (items.length > 0) {
        items.sort((a, b) => a.price - b.price);
        const minItem = items[0];
        
        const sliceCount = Math.min(items.length, 6);
        const topSlice = items.slice(0, sliceCount);
        const avgPrice = Math.round(topSlice.reduce((acc, x) => acc + x.price, 0) / sliceCount);
        
        response.ml = {
          minPrice: minItem.price,
          minUrl: minItem.permalink,
          avgPrice: avgPrice,
          searchUrl: `https://listado.mercadolibre.com.ar/${encodeURIComponent(cleaned)}`
        };
      }
    }

    if (puppisData && Array.isArray(puppisData) && puppisData.length > 0) {
      const prod = puppisData[0];
      if (prod.items && prod.items[0] && prod.items[0].sellers && prod.items[0].sellers[0]) {
        const offer = prod.items[0].sellers[0].commertialOffer;
        if (offer && offer.Price) {
          response.puppis = {
            price: offer.Price,
            url: prod.link || 'https://www.puppis.com.ar'
          };
        }
      }
    }

    res.json(response);
  } catch (e) {
    console.error("Error in reference-prices route:", e);
    res.status(500).json({ error: 'Error interno en el servidor' });
  }
});

// 7. Login Authentication
app.post('/api/auth/login', async (req, res) => {
  try {
    const { user, pass } = req.body;
    const config = await getConfig();
    
    if (user === config.adminUser && pass === config.adminPass) {
      return res.json({ token: ADMIN_TOKEN });
    }
    
    res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  } catch (e) {
    res.status(500).json({ error: 'Error de autenticación' });
  }
});

// Catch-all to serve index.html for frontend routing or refresh
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start DB & Express Server
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`=== Servidor iniciado en http://localhost:${PORT} ===`);
  });
});
