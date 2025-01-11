require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const morgan = require('morgan')

const port = process.env.PORT || 9000
const app = express()
// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())
app.use(morgan('dev'))

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}

// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mq0mae1.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`

const uri = `mongodb://localhost:27017`

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
  try {
    const db = client.db('plant-net-DB');
    const usersCollection = db.collection('users');
    const plantsCollection = db.collection('plants');
    const ordersCollection = db.collection('orders');

    // save or update a user in db 
    app.post('/users/:email', async (req, res) => {
      const email = req.body.email
      const user = req.body
      // check if user exists in db
      const isExist = await usersCollection.findOne({ email: email })
      if (isExist) {
        return res.send(isExist)
      }
      const result = await usersCollection.insertOne({ ...user, role: 'customer', timestamp: Date.now() })
      res.send(result)
    })
    // Generate jwt token
    app.post('/jwt', async (req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })
    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    })



    // save a plant to the database
    app.post('/plants', verifyToken, async (req, res) => {
      const plant = req.body
      const result = await plantsCollection.insertOne(plant);
      res.send(result)
    })
    // Get all plants from the database
    app.get('/plants', async (req, res) => {
      const result = await plantsCollection.find().limit(8).toArray();
      res.send(result)
    })
    // Get a plant by id
    app.get('/plants/:id', async (req, res) => {
      const id = req.params.id;
      const result = await plantsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    })

    // save order data to database
    app.post('/orders', verifyToken, async (req, res) => {
      const orderInfo = req.body;
      console.log('order info : ----', orderInfo);
      const result = await ordersCollection.insertOne(orderInfo);
      res.send(result);
    })

    // get all orders for a customer;
    app.get('/customer-orders/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { 'customer.email': email };
      const result = await ordersCollection.aggregate([
        {
          $match: query,//match specific customers data only by email
        },
        {
          $addFields: {
            plantId: { $toObjectId: '$plantId' },// conver plantId string to objectid field
          }
        },
        {
          $lookup: {
            //go to a defferent collection and look for data 
            from: 'plants',// collection name 
            localField: 'plantId',// local data that you want to match
            foreignField: '_id', // foreign field name of that same data 
            as: 'plants' //return the data as plants array {array naming }
          }
        },
        {
          $unwind: '$plants'// unwind lookup result , return without array
        },
        {
          $addFields: {
            // add these fields in order object 
            name: '$plants.name',
            image: '$plants.image',
            category: '$plants.category',

          }
        }, {
          $project: {
            // remove plants object property from order object
            plants: 0,
            // customer:0
          }
        }
      ]).toArray();
      res.send(result);
    })

    // cancel/delete an order 
    app.delete('/orders/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const order = await ordersCollection.findOne(query);
      if (order.status === 'Delivered') {
        return res.status(409).send({ message: 'Cannot cancel delivered order.' });
      }
      const result = await ordersCollection.deleteOne(query);
      res.send(result);
    })

    // manage plant quantity
    app.patch('/plants/quantity/:id', verifyToken, async (req, res) => {
      const id = req.params?.id;
      const { quantityToUpdate, status } = req.body;
      const filter = { _id: new ObjectId(id) };
      let updateDoc = { $inc: { quantity: -quantityToUpdate } };
      if (status === 'increase') {
        updateDoc = { $inc: { quantity: quantityToUpdate } };
      }
      const result = await plantsCollection.updateOne(filter, updateDoc);
      res.send(result);
    })
    // app.patch()
    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from plantNet Server..')
})

app.listen(port, () => {
  console.log(`plantNet is running on port ${port}`)
})
