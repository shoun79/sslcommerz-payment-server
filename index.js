const express = require("express");
const cors = require("cors");
const SSLCommerzPayment = require('sslcommerz-lts');
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

//sslcommerz
const store_id = process.env.STORE_ID
const store_passwd = process.env.STORE_PASS
const is_live = false //true for live, false for sandbox


// middle wares
// app.use(cors());
app.use(cors({
    origin: ['http://localhost:3000'],
    credentials: true
}));
app.use(express.json());

// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.twtll.mongodb.net/?retryWrites=true&w=majority`;
// const uri = "mongodb://localhost:27017";

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cg7riyw.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).send({ message: "unauthorized access" });
    }
    const token = authHeader.split(" ")[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: "Forbidden access" });
        }
        req.decoded = decoded;
        next();
    });
}


async function run() {
    try {
        const serviceCollection = client.db("geniusCar").collection("services");
        const orderCollection = client.db("geniusCar").collection("orders");

        app.post("/jwt", (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1d" });
            res.send({ token });
        });

        app.get("/services", async (req, res) => {
            const search = req.query.search;
            console.log(search);
            let query = {};
            if (search.length) {
                query = {
                    $text: {
                        $search: search
                    }
                };

            }
            // const query = { price: { $gt: 100, $lt: 300 } }
            // const query = { price: { $eq: 200 } }
            // const query = { price: { $lte: 200 } }
            // const query = { price: { $ne: 150 } }
            // const query = { price: { $in: [20, 40, 150] } }
            // const query = { price: { $nin: [20, 40, 150] } }
            // const query = { $and: [{price: {$gt: 20}}, {price: {$gt: 100}}] }
            const order = req.query.order === "asc" ? 1 : -1;
            const cursor = serviceCollection.find(query).sort({ price: order });
            const services = await cursor.toArray();
            res.send(services);
        });

        app.get("/services/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const service = await serviceCollection.findOne(query);
            res.send(service);
        });


        // orders api
        app.get("/orders", verifyJWT, async (req, res) => {
            const decoded = req.decoded;

            if (decoded.email !== req.query.email) {
                res.status(403).send({ message: "unauthorized access" });
            }

            let query = {};
            if (req.query.email) {
                query = {
                    email: req.query.email
                };
            }
            const cursor = orderCollection.find(query);
            const orders = await cursor.toArray();
            res.send(orders);
        });

        app.post("/orders", verifyJWT, async (req, res) => {
            const order = req.body;
            const { } = order;
            if (!customer || !email || !address || !postcode) {
                return res.send({ error: 'Please Provide all the information' })
            }
            const orderedService = await serviceCollection.findOne({ _id: ObjectId(order.service) });
            const transactionId = new ObjectId().toString();
            const data = {
                total_amount: orderedService.price,
                currency: order.currency,
                tran_id: transactionId,
                success_url: `${process.env.Server_URL}/payment/success?transactionId=${transactionId}`,
                fail_url: `${process.env.Server_URL}/payment/fail?transactionId=${transactionId}`,
                cancel_url: `${process.env.Server_URL}/payment/cancel`,
                ipn_url: `${process.env.Server_URL}/payment/ipn`,
                shipping_method: 'Courier',
                product_name: 'Computer.',
                product_category: 'Electronic',
                product_profile: 'general',
                cus_name: order.customer,
                cus_email: order.email,
                cus_add1: order.address,
                cus_add2: 'Dhaka',
                cus_city: 'Dhaka',
                cus_state: 'Dhaka',
                cus_postcode: order.postcode,
                cus_country: 'Bangladesh',
                cus_phone: '01711111111',
                cus_fax: '01711111111',
                ship_name: 'Customer Name',
                ship_add1: 'Dhaka',
                ship_add2: 'Dhaka',
                ship_city: 'Dhaka',
                ship_state: 'Dhaka',
                ship_postcode: 1000,
                ship_country: 'Bangladesh',
            };


            const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live)
            sslcz.init(data).then(apiResponse => {
                // Redirect the user to payment gateway
                let GatewayPageURL = apiResponse.GatewayPageURL;
                orderCollection.insertOne({
                    ...order,
                    price: orderedService.price,
                    transactionId,
                    paid: false
                })
                res.send({ url: GatewayPageURL })

            });


        });

        app.post("/payment/success", async (req, res) => {
            const { transactionId } = req.query;
            // if (!transactionId) {
            //     return res.redirect('http://localhost:3000/payment/fail')
            // }


            if (transactionId) {
                const result = await orderCollection.updateOne({ transactionId }, { $set: { paid: true, paidAt: new Date() } });
                if (result.modifiedCount) {
                    res.redirect(`${process.env.Client_URL}/payment/success?transactionId=${transactionId}`)
                }

            }
            else {
                return res.redirect(`${process.env.Client_URL}/payment/fail`)
            }





        })
        app.post("/payment/fail", async (req, res) => {

            const { transactionId } = req.query;
            if (!transactionId) {
                return res.redirect(`${process.env.Client_URL}/payment/fail`)
            }

            const result = await orderCollection.deleteOne({ transactionId });
            if (result.deletedCount) {
                res.redirect(`${process.env.Client_URL}/payment/fail`)
            }

        })

        app.get('/orders/by-transaction-id/:id', async (req, res) => {
            const { id } = req.params;
            const order = await orderCollection.findOne({ transactionId: id });
            res.send(order)
        })

        app.patch("/orders/:id", verifyJWT, async (req, res) => {
            const id = req.params.id;
            const status = req.body.status;
            const query = { _id: ObjectId(id) };
            const updatedDoc = {
                $set: {
                    status: status
                }
            };
            const result = await orderCollection.updateOne(query, updatedDoc);
            res.send(result);
        });

        app.delete("/orders/:id", verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await orderCollection.deleteOne(query);
            res.send(result);
        });


    }
    finally {

    }

}

run().catch(err => console.error(err));


app.get("/", (req, res) => {
    res.send("genius car server is running");
});

app.listen(port, () => {
    console.log(`Genius Car server running on ${port}`);
});