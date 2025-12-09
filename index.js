const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const app = express();
app.use(express.json());
app.use(cors());

const port = process.env.PORT || 3000;

const crypto = require("crypto");

const admin = require("firebase-admin");

const serviceAccount = require("./decoration-booking-system-firebase-adminsdk-fbsvc-81831d7ef6.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

function generateTrackingId() {
  // Format date as YYYYMMDD
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "");

  // Generate 4 random bytes → 8 hex chars
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();

  // Final tracking ID
  return `TRK-${date}-${random}`;
}


// Middleware
const verifyFbToken = async (req, res, next) => {
  // console.log('headers in the middle ware', req.headers?.authorization)
  const token = req.headers.authorization
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  try {
    const idToken = token.split(' ')[1]
    const decoded = await admin.auth().verifyIdToken(idToken)
    console.log('decoded token', decoded)
    req.decoded_email = decoded.email
    next()
  }
  catch (err) {
    return res.status(401).send({ message: 'unauthorized access' })
  }

}

// MONGO DB CONNECTION
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.vmnyifr.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();

    const db = client.db('decoration_booking_system');
    const userCollections = db.collection('users');
    const parcelsCollections = db.collection('parcels');
    const paymentCollections = db.collection('payments');
    const servicesCollection = db.collection('services');
    const bookingCollection = db.collection('booking');
    const decoratorCollection = db.collection('decorator');


    // User Related API 
    app.post('/users', async (req, res) => {
      const user = req.body;
      user.role = 'user';
      user.createdAt = new Date();
      const email = user.email;
      const existingUser = await userCollections.findOne({ email: email });
      if (existingUser) {
        return res.send({ message: 'User already exists' })
      }
      const result = await userCollections.insertOne(user);
      res.send(result);
    });

    // Deceretor Related API 
    app.post('/decorator', async (req, res) => {
      const decorator = req.body;
      decorator.role = 'pending';
      decorator.createdAt = new Date();
      // const email = decorator.email;
      const result = await decoratorCollection.insertOne(decorator);
      res.send(result);
    })


    // Get Deceretor API
    app.get('/decorator', async (req, res) => {
      const query = {};

      if (req.query.role) {
        query.role = req.query.role; // e.g. "pending"
      }

      const result = await decoratorCollection.find(query).toArray();
      res.send(result);
    });


    // Aproove Deceretor API
    app.patch('/decorator/:id', verifyFbToken, async (req, res) => {
      try {
        const status = req.body.role;
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        // Decorator collection update
        const update = {
          $set: { role: status }
        };
        const result = await decoratorCollection.updateOne(query, update);

        // যদি approved হয়ে role 'decorator' হয়, তাহলে main user collection update
        if (status === 'decorator') {
          const decorator = await decoratorCollection.findOne(query);
          if (decorator) {
            const userQuery = { email: decorator.email };
            const userUpdate = { $set: { role: 'decorator' } };
            await userCollections.updateOne(userQuery, userUpdate);
          }
        }

        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Server Error' });
      }
    });




    // 📦 PARCEL API
    // Get All Services 
    app.get('/services', async (req, res) => {
      const result = await servicesCollection.find().toArray()

      res.send(result)
    })

    app.get('/services/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await servicesCollection.findOne(query);
      res.send(result);
    });

    // Booking Related API 
    app.post('/booking', async (req, res) => {
      const booking = req.body;
      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    })

    // my booking 
    app.get('/booking', async (req, res) => {
      const query = {};
      const { email } = req.query;

      if (email) {
        query.userEmail = email;
      }

      const options = { sort: { createdAt: -1 } };
      const result = await bookingCollection.find(query, options).toArray();
      res.send(result);
    });

    // booking update
    // booking update (only bookedDate)
    // app.patch('/booking/:id', async (req, res) => {
    //   const bookingId = req.params.id; // URL থেকে id
    //   const { bookedDate } = req.body;

    //   if (!bookedDate) {
    //     return res.status(400).json({ error: "Booked date is required." });
    //   }

    //   // Validate future date only
    //   const today = new Date();
    //   const parts = bookedDate.split("-"); // "DD-MM-YYYY"
    //   const newDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);

    //   if (newDate < today.setHours(0, 0, 0, 0)) {
    //     return res.status(400).json({ error: "Booked date must be in the future." });
    //   }

    //   try {
    //     const result = await bookingCollection.updateOne(
    //       { _id: new ObjectId(bookingId) }, // ObjectId হিসেবে convert
    //       { $set: { bookedDate } } // শুধু bookedDate আপডেট হবে
    //     );

    //     if (result.modifiedCount > 0) {
    //       res.json({ modifiedCount: result.modifiedCount });
    //     } else {
    //       res.status(404).json({ error: "Booking not found or no changes made." });
    //     }
    //   } catch (error) {
    //     console.error(error);
    //     res.status(500).json({ error: "Internal server error." });
    //   }
    // });
    app.patch('/booking/:id', async (req, res) => {
      const bookingId = req.params.id;
      const { bookedDate, squareFeet, finalCost } = req.body;

      // Basic presence
      if (!bookedDate) {
        console.error('Patch error: bookedDate missing in request body', req.body);
        return res.status(400).json({ error: "Booked date is required." });
      }

      // Ensure date is parseable
      const newDate = new Date(bookedDate);
      if (isNaN(newDate.getTime())) {
        console.error('Patch error: invalid bookedDate format', bookedDate);
        return res.status(400).json({ error: "Invalid bookedDate format. Use YYYY-MM-DD." });
      }

      // Optional: ensure future date
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (newDate < today) {
        console.error('Patch error: bookedDate is in the past', bookedDate);
        return res.status(400).json({ error: "Booked date must be in the future." });
      }

      // Validate numeric fields if provided
      const sf = squareFeet !== undefined ? Number(squareFeet) : undefined;
      const fc = finalCost !== undefined ? Number(finalCost) : undefined;

      if (squareFeet !== undefined && (isNaN(sf) || sf < 0)) {
        return res.status(400).json({ error: "squareFeet must be a non-negative number." });
      }
      if (finalCost !== undefined && (isNaN(fc) || fc < 0)) {
        return res.status(400).json({ error: "finalCost must be a non-negative number." });
      }

      try {
        const updateDoc = {
          $set: {
            bookedDate,
          }
        };
        if (sf !== undefined) updateDoc.$set.squareFeet = sf;
        if (fc !== undefined) updateDoc.$set.finalCost = fc;

        console.log('Patch request for bookingId:', bookingId, 'update:', updateDoc.$set);

        const result = await bookingCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          updateDoc
        );

        if (result.modifiedCount > 0) {
          return res.json({ modifiedCount: result.modifiedCount });
        } else {
          return res.status(404).json({ error: "Booking not found or no changes made." });
        }
      } catch (error) {
        console.error('Patch exception:', error);
        return res.status(500).json({ error: "Internal server error." });
      }
    });









    // delete Booking 
    app.delete('/booking/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingCollection.deleteOne(query);
      res.send(result);
    });

    // Payment API
    app.post('/payment-checkout-session', async (req, res) => {
      const paymentInfo = req.body;

      // Ensure cost is number
      const amount = Number(paymentInfo.cost) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: `Please Pay for: ${paymentInfo.parcelName}`,
              },
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
        },
        customer_email: paymentInfo.userEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      res.send({ url: session.url });
    });


    app.get('/payments', async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.customerEmail = email;
        const cursor = paymentCollections.find(query);
        const result = await cursor.toArray();
        return res.send(result);
      }
    })


    // payment status paid 
    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      const transactionId = session.payment_intent
      query = { transactionId: transactionId }
      const existingPayment = await paymentCollections.findOne(query);
      if (existingPayment) {
        return res.send({
          success: true,
          message: 'Payment already processed',
          transactionId: transactionId,
          trackingId: existingPayment.trackingId
        });
      }


      console.log('session retrive', session)
      const trackingId = generateTrackingId()
      if (session.payment_status === 'paid') {
        const id = session.metadata.parcelId
        const query = { _id: new ObjectId(id) }
        const update = {
          $set: {
            paymentStatus: 'paid',
            trackingId: trackingId,

          }
        }
        const result = await bookingCollection.updateOne(query, update)
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          ParcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,

        }
        if (session.payment_status === 'paid') {
          const resultPayment = await paymentCollections.insertOne(payment)
          res.send({ success: true, transactionId: session.payment_intent, modifyParcel: result, trackingId: trackingId, paymentInfo: resultPayment })

        }

      }
      res.send({ success: false })
    })





    // decorator related API 
    app.get('/decorator', async (req, res) => {
      const result = await decoratorCollection.find().toArray()

      res.send(result)
    })



    // Get all parcels OR parcels by email
    app.get('/parcels', async (req, res) => {
      const query = {};
      const { email } = req.query;

      if (email) {
        query.senderEmail = email;
      }

      const options = { sort: { createdAt: -1 } };
      const result = await parcelsCollections.find(query, options).toArray();
      res.send(result);
    });

    // Get parcel by ID
    app.get('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollections.findOne(query);
      res.send(result);
    });

    // Create parcel
    app.post('/parcels', async (req, res) => {
      const parcel = req.body;
      parcel.createdAt = new Date();
      const result = await parcelsCollections.insertOne(parcel);
      res.send(result);
    });

    // Delete parcel
    app.delete('/parcels/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollections.deleteOne(query);
      res.send(result);
    });


    // Payment

    // ============================
    // 💳 PAYMENT API (STRIPE) 
    // ============================
    // payment-checkout-session
    // New 
    app.post('/payment-checkout-session', async (req, res) => {
      const paymentInfo = req.body
      const amount = parseInt(paymentInfo.cost) * 100
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {

            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: `Please Pay for: ${paymentInfo.parcelName}`
              }
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,


        },
        customer_email: paymentInfo.senderEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      })
      res.send({ url: session.url })
    })



    // Old 
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: {
                name: paymentInfo.parcelName,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.senderEmail,
        mode: 'payment',
        metadata: {
          parcelId: paymentInfo.parcelId,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      res.send({ url: session.url });
    });

    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      console.log('session retrive', session)
      const trackingId = generateTrackingId()
      if (session.payment_status === 'paid') {
        const id = session.metadata.parcelId
        const query = { _id: new ObjectId(id) }
        const update = {
          $set: {
            paymentStatus: 'paid',
            trackingId: trackingId,
          }
        }
        const result = await parcelsCollections.updateOne(query, update)
        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          ParcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),

        }
        if (session.payment_status === 'paid') {
          const resultPayment = await paymentCollections.insertOne(payment)
          res.send({ success: true, transactionId: session.payment_intent, modifyParcel: result, trackingId: trackingId, paymentInfo: resultPayment })

        }

      }
      res.send({ success: false })
    })

    // MongoDB test ping
    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB!");
  } finally { }
}

run().catch(console.dir);


// HOME ROUTE
app.get('/', (req, res) => {
  res.send('Zap is Shifting Shifting');
});

// SERVER LISTEN
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
