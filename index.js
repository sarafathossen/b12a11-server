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


const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

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
    // await client.connect();

    const db = client.db('decoration_booking_system');
    const userCollections = db.collection('users');
    const parcelsCollections = db.collection('parcels');
    const paymentCollections = db.collection('payments');
    const servicesCollection = db.collection('services');
    const bookingCollection = db.collection('booking');
    const decoratorCollection = db.collection('decorator');
    const trackingCollection = db.collection('tracking');



    // middle admin before allowing admin activity
    // must be used after verifyFBToken middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollections.findOne(query);

      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' });
      }

      next();
    }
    const verifyDecorator = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollections.findOne(query);

      if (!user || user.role !== 'decorator') {
        return res.status(403).send({ message: 'forbidden access' });
      }

      next();
    }

    const logTracking = async (trackingId, status) => {
      const log = {
        trackingId,
        status,
        details: status.split('_').join(' '),
        createdAt: new Date()
      }
      const result = await trackingCollection.insertOne(log);
      return result;
    }


    // User Related API 
    app.post('/users', verifyFbToken,verifyAdmin, async (req, res) => {
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
    app.post('/decorator', verifyFbToken,verifyAdmin, async (req, res) => {
      const decorator = req.body;
      decorator.role = 'pending';
      decorator.createdAt = new Date();
      // const email = decorator.email;
      const result = await decoratorCollection.insertOne(decorator);
      res.send(result);
    })


    // Get Deceretor API
    app.get('/decorator', async (req, res) => {
      const { role, specialty, decoratorWorkingStatus } = req.query;
      const query = {};

      if (role) {
        query.role = role;
      }

      if (specialty) {
        query.specialty = specialty;
      }

      if (decoratorWorkingStatus) {
        query.decoratorWorkingStatus = decoratorWorkingStatus;
      }

      const result = await decoratorCollection.find(query).toArray();
      res.send(result);
    });

    // Delete Deceretor 
    app.delete('/decorator/:id',verifyFbToken,verifyAdmin, async (req, res) => {
      const id = req.params.id;

      const result = await decoratorCollection.deleteOne({
        _id: new ObjectId(id)
      });

      res.send(result);
    });



    // Aproove Deceretor API
    app.patch('/decorator/:id', verifyFbToken,verifyAdmin, async (req, res) => {
      try {
        const status = req.body.role;
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        // Decorator collection update
        const update = {
          $set: { role: status, deceretorWorkingStatus: 'available' }
        };
        const result = await decoratorCollection.updateOne(query, update);

        // যদি approved হয়ে role 'decorator' হয়, তাহলে main user collection update
        if (status === 'decorator') {
          const decorator = await decoratorCollection.findOne(query);
          if (decorator) {
            const userQuery = { email: decorator.email };
            const userUpdate = {
              $set: {
                role: 'decorator',
                decoratorWorkingStatus: 'pending'   // <-- এখানে পরিবর্তন
              }
            };

            // await userCollections.updateOne(userQuery, userUpdate);
            await userCollections.updateOne(userQuery, userUpdate);
          }
        }

        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Server Error' });
      }
    });
    // Update decorator workingStatus
    app.patch('/decorator/:id/workingStatus', verifyFbToken, async (req, res) => {
      try {
        const id = req.params.id;
        const { deceretorWorkingStatus } = req.body;

        const query = { _id: new ObjectId(id) };
        const update = { $set: { deceretorWorkingStatus } };

        const result = await decoratorCollection.updateOne(query, update);

        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Server Error' });
      }
    });



    // decorator related API 
    app.get('/decorator', async (req, res) => {

      const query = {};


      const result = await decoratorCollection.find().toArray()

      res.send(result)
    })



    // 📦 PARCEL API
    // Get All Services 
    app.get('/services', async (req, res) => {
      const result = await servicesCollection.find().sort({ createdAt: -1 }).toArray();
      res.send(result);
    });

    app.delete("/services/:id", verifyFbToken,verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await servicesCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) {
          res.send({ message: "Service deleted successfully" });
        } else {
          res.status(404).send({ message: "Service not found" });
        }
      } catch (err) {
        res.status(500).send({ message: err.message });
      }
    });

    app.patch("/services/:id", verifyFbToken,verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;

        // ID যাচাই
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid service ID" });
        }

        // শুধু অনুমোদিত ফিল্ড আপডেট হবে
        const allowedFields = ["name", "image", "price", "category", "description", "longDescription", "rating", "reviews", "duration", "available"];
        const updateFields = {};
        allowedFields.forEach(field => {
          if (req.body[field] !== undefined) {
            updateFields[field] = req.body[field];
          }
        });

        if (Object.keys(updateFields).length === 0) {
          return res.status(400).send({ message: "No valid fields to update" });
        }

        const result = await servicesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields }
        );

        if (result.modifiedCount === 1) {
          res.send({ message: "Service updated successfully" });
        } else {
          res.status(404).send({ message: "Service not found or no changes" });
        }
      } catch (err) {
        console.error("Error updating service:", err);
        res.status(500).send({ message: err.message });
      }
    });





    app.get('/services/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await servicesCollection.findOne(query);
      res.send(result);
    });

    // Booking Related API 
    app.post('/booking', verifyFbToken, async (req, res) => {
      const booking = req.body;
      const trackingId = generateTrackingId()
      booking.trackingId = trackingId
      logTracking(trackingId, 'booking_placed')
      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    })

    // my booking  

    app.get('/booking',verifyFbToken, async (req, res) => {
      const query = {};
      const { email, deceretorEmail, workingStatus } = req.query;

      if (email) {
        query.userEmail = email; // logged-in user email
      }
      if (deceretorEmail) {
        query.deceretorEmail = deceretorEmail; // decorator email
      }
      if (workingStatus) {
        query.workingStatus = workingStatus;
      }

      // MongoDB query + sort
      const result = await bookingCollection
        .find(query)
        .sort({ createdAt: -1 }) // latest booking first
        .toArray();

      res.send(result);
    });

    // Get only finished bookings

    app.get('/booking/finished', async (req, res) => {
      try {
        const query = { workingStatus: "finished" };

        const result = await bookingCollection
          .find(query)
          .sort({ createdAt: -1 }) // latest first
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch finished bookings' });
      }
    });



    // app.patch('/booking/:id/workingStatus', async (req, res) => {
    //   try {
    //     const { workingStatus, deceretorId, trackingId } = req.body;

    //     const query = { _id: new ObjectId(req.params.id) };
    //     const updatedDoc = { $set: { workingStatus } };

    //     // Update decorator if work finished
    //     if (workingStatus === "finished_work" && deceretorId) {
    //       const decoratorResult = await decoratorCollection.updateOne(
    //         { _id: new ObjectId(deceretorId) },
    //         { $set: { deceretorWorkingStatus: 'available' } }
    //       );
    //       console.log("Decorator updated:", decoratorResult.modifiedCount);
    //     }

    //     const result = await bookingCollection.updateOne(query, updatedDoc);

    //     logTracking(trackingId, workingStatus)
    //     res.send(result);

    //   } catch (error) {
    //     console.error("PATCH ERROR:", error);
    //     res.status(500).send({ error: true, message: error.message });
    //   }
    // });


    app.patch('/booking/:id/workingStatus', verifyFbToken, async (req, res) => {
      try {
        const { workingStatus, deceretorId, trackingId } = req.body;

        const query = { _id: new ObjectId(req.params.id) };
        const booking = await bookingCollection.findOne(query);
        if (!booking) return res.status(404).send({ error: true, message: "Booking not found" });

        const finalTrackingId = booking.trackingId || trackingId;

        const updatedDoc = {
          $set: {
            workingStatus,
            deceretorId: deceretorId || booking.deceretorId
          }
        };

        const result = await bookingCollection.updateOne(query, updatedDoc);

        // Tracking log
        logTracking(finalTrackingId, workingStatus);

        res.send({ modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("PATCH ERROR:", error);
        res.status(500).send({ error: true, message: error.message });
      }
    });



    app.get('/booking/decorator', async (req, res) => {
      const { deceretorEmail, workingStatus } = req.query;
      const query = {};
      if (deceretorEmail) {
        query.deceretorEmail = deceretorEmail;
      }
      if (workingStatus !== 'finished_work') {
        query.workingStatus = { $nin: ['finished_work'] };
      }
      else {
        query.workingStatus = workingStatus
      }
      const cursor = bookingCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);

    })


  

    app.patch('/booking/:id',verifyFbToken, async (req, res) => {
      const bookingId = req.params.id;
      const {
        bookedDate,
        squareFeet,
        finalCost,
        deceretorId,
        deceretorName,
        deceretorEmail,
        trackingId,
      } = req.body;

      try {
        // ===== 1️⃣ Validate bookedDate (DD-MM-YYYY) =====
        let parsedDate = null;

        if (bookedDate) {
          const parts = bookedDate.split('-'); // DD-MM-YYYY

          if (parts.length !== 3) {
            return res.status(400).json({
              error: "Invalid bookedDate format. Use DD-MM-YYYY."
            });
          }

          const [day, month, year] = parts.map(Number);
          parsedDate = new Date(year, month - 1, day);

          if (isNaN(parsedDate.getTime())) {
            return res.status(400).json({
              error: "Invalid bookedDate value."
            });
          }

          const today = new Date();
          today.setHours(0, 0, 0, 0);

          if (parsedDate < today) {
            return res.status(400).json({
              error: "Booked date must be today or a future date."
            });
          }
        }

        // ===== 2️⃣ Validate numeric fields =====
        const sf = squareFeet !== undefined ? Number(squareFeet) : undefined;
        const fc = finalCost !== undefined ? Number(finalCost) : undefined;

        if (sf !== undefined && (isNaN(sf) || sf < 0)) {
          return res.status(400).json({
            error: "squareFeet must be a non-negative number."
          });
        }

        if (fc !== undefined && (isNaN(fc) || fc < 0)) {
          return res.status(400).json({
            error: "finalCost must be a non-negative number."
          });
        }

        // ===== 3️⃣ Build update document =====
        const updateDoc = { $set: {} };

        if (bookedDate) updateDoc.$set.bookedDate = bookedDate; // keep DD-MM-YYYY
        if (sf !== undefined) updateDoc.$set.squareFeet = sf;
        if (fc !== undefined) updateDoc.$set.finalCost = fc;

        // decorator assign
        if (deceretorId) {
          updateDoc.$set.workingStatus = 'decorator_assigned';
          updateDoc.$set.deceretorId = deceretorId;
          updateDoc.$set.deceretorName = deceretorName;
          updateDoc.$set.deceretorEmail = deceretorEmail;
        }

        // ===== 4️⃣ Update booking =====
        const result = await bookingCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          updateDoc
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: "Booking not found." });
        }

        // ===== 5️⃣ Update decorator status =====
        let decoratorResult = null;

        if (deceretorId) {
          decoratorResult = await decoratorCollection.updateOne(
            { _id: new ObjectId(deceretorId) },
            { $set: { deceretorWorkingStatus: 'in_delivery' } }
          );
        }

        // ===== 6️⃣ Tracking log =====
        if (trackingId && deceretorId) {
          logTracking(trackingId, 'decorator_assigned');
        }

        // ===== 7️⃣ Final response =====
        return res.json({
          modifiedCount: result.modifiedCount,   // 🔥 frontend expects this
          decoratorUpdated: decoratorResult ? decoratorResult.modifiedCount : 0
        });

      } catch (error) {
        console.error('Patch exception:', error);
        return res.status(500).json({ error: "Internal server error." });
      }
    });


    // Service Relater API 

    // Service Create 
    app.post('/service',verifyFbToken,verifyAdmin, async (req, res) => {
      try {
        const booking = req.body;

        if (!booking.serviceId || !booking.userEmail) {
          return res.status(400).send({ message: 'Missing required fields' });
        }

        const newBooking = {
          ...booking,
          status: booking.status || 'pending',
          createdAt: new Date(),
        };

        const result = await servicesCollection.insertOne(newBooking);

        res.send({
          success: true,
          insertedId: result.insertedId,
        });
      } catch (error) {
        res.status(500).send({ message: 'Failed to create booking' });
      }
    });





    // delete Booking 
    app.delete('/booking/:id',verifyFbToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingCollection.deleteOne(query);
      res.send(result);
    });

    // Payment API
    app.post('/payment-checkout-session',verifyFbToken, async (req, res) => {
      const paymentInfo = req.body;

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
          trackingId: paymentInfo.trackingId || "",
        },
        customer_email: paymentInfo.customerEmail, // ✅ Correct field
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      res.send({ url: session.url });
    });


    app.get('/payments',verifyFbToken, async (req, res) => {
      const email = req.query.email;
      const query = {};

      if (email) {
        query.customerEmail = email;
      }

      const result = await paymentCollections
        .find(query)
        .sort({ paidAt: -1 }) // 🔥 latest payment first
        .toArray();

      res.send(result);
    });



    // payment status paid 
    // app.patch('/payment-success', async (req, res) => {
    //   try {
    //     const sessionId = req.query.session_id;
    //     if (!sessionId) return res.status(400).send({ success: false, message: "Missing session_id" });

    //     const session = await stripe.checkout.sessions.retrieve(sessionId);
    //     const transactionId = session.payment_intent;

    //     // Duplicate check
    //     const existingPayment = await paymentCollections.findOne({ transactionId });
    //     if (existingPayment) {
    //       return res.send({
    //         success: true,
    //         message: 'Payment already processed',
    //         transactionId,
    //         trackingId: existingPayment.trackingId
    //       });
    //     }

    //     if (session.payment_status !== 'paid') return res.send({ success: false, message: "Payment not completed" });
    //     if (!session.metadata?.parcelId) return res.status(400).send({ success: false, message: "Missing metadata" });

    //     const parcelId = session.metadata.parcelId;
    //     const trackingId = generateTrackingId();

    //     // Safe query
    //     const query = ObjectId.isValid(parcelId)
    //       ? { _id: new ObjectId(parcelId) }
    //       : { _id: parcelId };

    //     const updateResult = await bookingCollection.updateOne(query, {
    //       $set: {
    //         paymentStatus: 'paid',
    //         workingStatus: 'pending-pickup',
    //         trackingId
    //       }
    //     });

    //     console.log("UpdateResult:", updateResult);

    //     const paymentData = {
    //       amount: session.amount_total / 100,
    //       currency: session.currency,
    //       customerEmail: session.customer_email,
    //       parcelId,
    //       parcelName: session.metadata.parcelName,
    //       transactionId,
    //       paymentStatus: session.payment_status,
    //       paidAt: new Date(),
    //       trackingId,
    //       workingStatus: 'pending-pickup', // <-- fixed here
    //     };


    //     const paymentInsert = await paymentCollections.insertOne(paymentData);
    //     // logTracking(trackingId);
    //     return res.send({
    //       success: true,
    //       message: "Payment processed successfully",
    //       transactionId,
    //       trackingId,
    //       modifyParcel: updateResult,
    //       paymentInfo: paymentInsert
    //     });

    //   } catch (err) {
    //     console.error("Payment Success Handler Error:", err);
    //     return res.status(500).send({ success: false, message: "Server error" });
    //   }
    // });
    app.patch('/payment-success',verifyFbToken, async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        if (!sessionId) return res.status(400).send({ success: false, message: "Missing session_id" });

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const transactionId = session.payment_intent;

        // Duplicate check
        const existingPayment = await paymentCollections.findOne({ transactionId });
        if (existingPayment) {
          return res.send({
            success: true,
            message: 'Payment already processed',
            transactionId,
            trackingId: existingPayment.trackingId
          });
        }

        if (session.payment_status !== 'paid') return res.send({ success: false, message: "Payment not completed" });
        if (!session.metadata?.parcelId) return res.status(400).send({ success: false, message: "Missing metadata" });

        const parcelId = session.metadata.parcelId;
        const trackingId = generateTrackingId();

        // Safe query
        const query = ObjectId.isValid(parcelId)
          ? { _id: new ObjectId(parcelId) }
          : { _id: parcelId };

        const updateResult = await bookingCollection.updateOne(query, {
          $set: {
            paymentStatus: 'paid',
            workingStatus: 'pending-pickup',
            trackingId: trackingId
          }
        });

        console.log("UpdateResult:", updateResult);

        const paymentData = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId,
          parcelName: session.metadata.parcelName,
          transactionId,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId,
          workingStatus: 'pending-pickup', // <-- fixed here
        };


        const paymentInsert = await paymentCollections.insertOne(paymentData);
        logTracking(trackingId, 'pending-pickup');
        return res.send({
          success: true,
          message: "Payment processed successfully",
          transactionId,
          trackingId,
          modifyParcel: updateResult,
          paymentInfo: paymentInsert
        });

      } catch (err) {
        console.error("Payment Success Handler Error:", err);
        return res.status(500).send({ success: false, message: "Server error" });
      }
    });




    // User Related API 
    app.get('/users', verifyFbToken, async (req, res) => {
      const cursor = userCollections.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get('/users/:email/role', verifyFbToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollections.findOne(query);
      res.send({ role: user?.role || 'user' });
    })


    // MAke Admin 
    app.patch('/users/:id/role', verifyFbToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const roleInfo = req.body;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: roleInfo.role
        }
      }
      const result = await userCollections.updateOne(query, updatedDoc)
      res.send(result);
    })




  // Payment Related API 

    app.patch('/payment-success', verifyFbToken, async (req, res) => {
      const sessionId = req.query.session_id
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      console.log('session retrive', session)



      const trackingId = session.metadata.trackingId;



      if (session.payment_status === 'paid') {
        const id = session.metadata.parcelId
        const query = { _id: new ObjectId(id) }
        const update = {
          $set: {
            paymentStatus: 'paid',

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
      return res.send({ success: false })
    })


    // Booking Count API 
    app.get('/booking/working-status/status',verifyFbToken, verifyAdmin, async (req, res) => {
      const pipeline = [
        {
          $facet: {
            // 🔹 Working Status wise count
            workingStatus: [
              {
                $group: {
                  _id: '$workingStatus',
                  count: { $sum: 1 }
                }
              },
              {
                $project: {
                  _id: 0,
                  workingStatus: '$_id',
                  count: 1
                }
              }
            ],

            // 🔹 Category wise count
            category: [
              {
                $group: {
                  _id: '$category',
                  count: { $sum: 1 }
                }
              },
              {
                $project: {
                  _id: 0,
                  category: '$_id',
                  count: 1
                }
              }
            ]
          }
        }
      ];

      const result = await bookingCollection.aggregate(pipeline).toArray();
      res.send(result[0]); // 🔥 খুব গুরুত্বপূর্ণ
    });

    // Tracking Realted API 
    app.get('/trackings/:trackingId/logs', async (req, res) => {
      const trackingId = req.params.trackingId
      const query = { trackingId }
      const result = await trackingCollection.find(query).toArray()
      res.send(result)
    })

    // MongoDB test ping
    // await client.db("admin").command({ ping: 1 });
    // console.log("Connected to MongoDB!");
  } finally { }
}

run().catch(console.dir);


// HOME ROUTE
app.get('/', (req, res) => {
  res.send('Home Decore');
});

// SERVER LISTEN
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
