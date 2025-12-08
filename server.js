const express = require("express");
const fetch = require("node-fetch"); // make sure node-fetch v2 installed
const cors = require("cors");

const app = express();

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: "*", // chaaho to yahan apne store ka domain de sakte ho
  })
);

// Simple health check for Render
app.get("/health", (req, res) => {
  res.send("OK");
});

// ===== ENV VARIABLES =====
const MPWA_API_KEY = process.env.MPWA_API_KEY;
const MPWA_SENDER = process.env.MPWA_SENDER;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE_DOMAIN;

// Temporary in-memory store for OTP
let tempStore = {};

// -------------------------------------------
// STEP 1 → SEND OTP
// -------------------------------------------
app.post("/start-cod", async (req, res) => {
  try {
    const {
      name,
      phone,
      house,
      street,
      landmark,
      city,
      state,
      pincode,
      variant_id,
      quantity,
      total,
    } = req.body;

    if (!phone || !variant_id || !quantity) {
      return res
        .status(400)
        .json({ ok: false, msg: "Missing phone / variant / quantity" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000);

    tempStore[phone] = {
      otp,
      data: {
        name,
        phone,
        house,
        street,
        landmark,
        city,
        state,
        pincode,
        variant_id,
        quantity,
        total,
      },
    };

    const msg = `🔐 *OTP Verification*

Hello ${name},
Your OTP is *${otp}*.
Order Amount: ₹${total}

Enter this OTP on website to confirm your COD order.`;

    await sendWA(phone, msg);
    res.json({ ok: true, msg: "OTP sent!" });
  } catch (error) {
    console.error("start-cod error:", error);
    res.status(500).json({ ok: false });
  }
});

// -------------------------------------------
// STEP 2 → VERIFY OTP + CREATE ORDER
// -------------------------------------------
app.post("/verify-cod", async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!tempStore[phone]) {
      return res.json({ ok: false, msg: "Session expired" });
    }

    if (String(tempStore[phone].otp) !== String(otp)) {
      return res.json({ ok: false, msg: "Invalid OTP" });
    }

    const data = tempStore[phone].data;

    const shopifyOrder = {
      order: {
        line_items: [
          {
            variant_id: Number(data.variant_id),
            quantity: Number(data.quantity),
          },
        ],
        billing_address: {
          name: data.name,
          address1: data.house,
          address2: `${data.street}, ${data.landmark}`,
          city: data.city,
          province: data.state,
          phone: data.phone,
          zip: data.pincode,
          country: "India",
        },
        shipping_address: {
          name: data.name,
          address1: data.house,
          address2: `${data.street}, ${data.landmark}`,
          city: data.city,
          province: data.state,
          phone: data.phone,
          zip: data.pincode,
          country: "India",
        },
        financial_status: "pending",
        gateway: "Cash on Delivery",
      },
    };

    const response = await fetch(
      `https://${SHOPIFY_STORE}/admin/api/2024-10/orders.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(shopifyOrder),
      }
    );

    const order = await response.json();
    delete tempStore[phone];

    await sendWA(
      phone,
      `🎉 *Order Confirmed!*

Your COD order is successfully placed.

Order No: *${order.order?.name || "N/A"}*
Total Amount: ₹${data.total}

Thank you ❤️`
    );

    res.json({ ok: true, order });
  } catch (error) {
    console.error("verify-cod error:", error);
    res.status(500).json({ ok: false });
  }
});

// ---------------------------------------------------
// SHOPIFY WEBHOOK — ORDER CREATED
// ---------------------------------------------------
app.post("/order-created", async (req, res) => {
  try {
    const order = req.body;
    const phone = clean(order.billing_address?.phone);

    if (phone) {
      await sendWA(
        phone,
        `🆕 *Order Received!*
Your order *${order.name}* has been successfully placed.
Total: ₹${order.total_price}`
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("order-created error:", err);
    res.sendStatus(500);
  }
});

// ---------------------------------------------------
// SHOPIFY WEBHOOK — ORDER UPDATED
// ---------------------------------------------------
app.post("/order-updated", async (req, res) => {
  try {
    const order = req.body;
    const phone = clean(order.billing_address?.phone);

    if (phone) {
      await sendWA(
        phone,
        `🔄 *Order Update*
Your order *${order.name}* has been updated.
Current Status: ${order.financial_status}`
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("order-updated error:", err);
    res.sendStatus(500);
  }
});

// ---------------------------------------------------
// SHOPIFY WEBHOOK — ORDER CANCELLED
// ---------------------------------------------------
app.post("/order-cancelled", async (req, res) => {
  try {
    const order = req.body;
    const phone = clean(order.billing_address?.phone);

    if (phone) {
      await sendWA(
        phone,
        `❌ *Order Cancelled*
Your order *${order.name}* has been cancelled.
If this was a mistake, you can reorder anytime.`
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("order-cancelled error:", err);
    res.sendStatus(500);
  }
});

// -------------------------------------------
// HELPERS
// -------------------------------------------
async function sendWA(number, message) {
  return fetch("https://codesai.dev/send-message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: MPWA_API_KEY,
      sender: MPWA_SENDER,
      number,
      message,
      footer: "Sent via ZapiKart.store",
    }),
  });
}

function clean(num) {
  return num ? num.replace(/[^0-9]/g, "") : null;
}

app.get("/", (req, res) =>
  res.send("COD OTP + Notifications Server (Render) Running ✔️")
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running on PORT", PORT));
