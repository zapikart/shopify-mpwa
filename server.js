const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const app = express();

app.use(express.json());
app.use(cors({ origin: "*" }));

// ENV VARIABLES
const MPWA_API_KEY = process.env.MPWA_API_KEY;
const MPWA_SENDER = process.env.MPWA_SENDER;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE_DOMAIN;

// TEMP STORE FOR OTP FLOW
let tempStore = {};

// -------------------------------------------
// STEP 1 → SEND OTP
// -------------------------------------------
app.post("/start-cod", async (req, res) => {
  try {
    const {
      name, phone, house, street, landmark,
      city, state, pincode,
      variant_id, quantity, total
    } = req.body;

    const otp = Math.floor(100000 + Math.random() * 900000);
    tempStore[phone] = {
      otp,
      data: {
        name, phone, house, street, landmark,
        city, state, pincode,
        variant_id, quantity, total
      }
    };

    const msg = `🔐 *OTP Verification*
Hello ${name},
Your OTP is *${otp}*.
Order Amount: ₹${total}

Enter this OTP on website to confirm your COD order.`;

    await sendWA(phone, msg);
    res.json({ ok: true, msg: "OTP sent!" });

  } catch (error) {
    console.log(error);
    res.status(500).json({ ok: false });
  }
});

// -------------------------------------------
// STEP 2 → VERIFY OTP + CREATE ORDER
// -------------------------------------------
app.post("/verify-cod", async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!tempStore[phone])
      return res.json({ ok: false, msg: "Session expired" });

    if (tempStore[phone].otp != otp)
      return res.json({ ok: false, msg: "Invalid OTP" });

    const data = tempStore[phone].data;

    // CREATE ORDER IN SHOPIFY
    const shopifyOrder = {
      order: {
        line_items: [
          {
            variant_id: Number(data.variant_id),
            quantity: Number(data.quantity)
          }
        ],
        billing_address: {
          name: data.name,
          address1: data.house,
          address2: `${data.street}, ${data.landmark}`,
          city: data.city,
          province: data.state,
          phone: data.phone,
          zip: data.pincode,
          country: "India"
        },
        shipping_address: {
          name: data.name,
          address1: data.house,
          address2: `${data.street}, ${data.landmark}`,
          city: data.city,
          province: data.state,
          phone: data.phone,
          zip: data.pincode,
          country: "India"
        },
        financial_status: "pending",
        gateway: "Cash on Delivery"
      }
    };

    const response = await fetch(
      `https://${SHOPIFY_STORE}/admin/api/2024-10/orders.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(shopifyOrder)
      }
    );

    const order = await response.json();
    delete tempStore[phone];

    await sendWA(
      phone,
      `🎉 *Order Confirmed!*

Your COD order is successfully placed.

Order No: *${order.order.name}*
Total Amount: ₹${data.total}

Thank you ❤️`
    );

    res.json({ ok: true, order: order });

  } catch (error) {
    console.log(error);
    res.status(500).json({ ok: false });
  }
});

// ---------------------------------------------------
// SHOPIFY WEBHOOK — ORDER CREATED
// ---------------------------------------------------
app.post("/order-created", async (req, res) => {
  const order = req.body;
  const phone = clean(order.billing_address?.phone);

  if (phone) {
    await sendWA(
      phone,
      `🆕 *Order Received!*\nYour order *${order.name}* has been successfully placed.\nTotal: ₹${order.total_price}`
    );
  }

  res.sendStatus(200);
});

// ---------------------------------------------------
// SHOPIFY WEBHOOK — ORDER UPDATED
// ---------------------------------------------------
app.post("/order-updated", async (req, res) => {
  const order = req.body;
  const phone = clean(order.billing_address?.phone);

  if (phone) {
    await sendWA(
      phone,
      `🔄 *Order Update*\nYour order *${order.name}* has been updated.\nCurrent Status: ${order.financial_status}`
    );
  }

  res.sendStatus(200);
});

// ---------------------------------------------------
// SHOPIFY WEBHOOK — ORDER CANCELLED
// ---------------------------------------------------
app.post("/order-cancelled", async (req, res) => {
  const order = req.body;
  const phone = clean(order.billing_address?.phone);

  if (phone) {
    await sendWA(
      phone,
      `❌ *Order Cancelled*\nYour order *${order.name}* has been cancelled.\nIf this was a mistake, you can reorder anytime.`
    );
  }

  res.sendStatus(200);
});

// -------------------------------------------
// HELPER FUNCTION → SEND WHATSAPP MESSAGE
// -------------------------------------------
async function sendWA(number, message) {
  return await fetch("https://codesai.dev/send-message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: MPWA_API_KEY,
      sender: MPWA_SENDER,
      number,
      message,
      footer: "Sent via MPWA"
    })
  });
}

function clean(num) {
  return num ? num.replace(/[^0-9]/g, "") : null;
}

app.get("/", (req, res) => res.send("COD OTP + Notifications Server Running ✔️"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on PORT", PORT));
