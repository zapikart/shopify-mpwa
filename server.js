// server.js

const express = require("express");
const fetch = require("node-fetch"); // node-fetch v2
const cors = require("cors");

const app = express();

// ----------------------
// MIDDLEWARE
// ----------------------
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

// ----------------------
// ENV VARIABLES
// ----------------------
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

Hello ${name || "Customer"},
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

    const shopifyOrderPayload = {
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
        body: JSON.stringify(shopifyOrderPayload),
      }
    );

    const orderJson = await response.json();

    if (!response.ok) {
      console.error("Shopify order error:", orderJson);
      return res
        .status(500)
        .json({ ok: false, msg: "Shopify order create failed" });
    }

    delete tempStore[phone];

    const shopifyOrder = orderJson.order || orderJson;
    const summary = buildOrderSummary(shopifyOrder);

    await sendWA(
      phone,
      `🎉 *COD Order Placed Successfully!*\n\n${summary}\n\nThank you ❤️`
    );

    res.json({ ok: true, order: orderJson });
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
    const phone = clean(
      order.billing_address?.phone || order.shipping_address?.phone
    );

    const summary = buildOrderSummary(order);

    if (phone) {
      await sendWA(
        phone,
        `🧾 *Order Confirmed!*\n\n${summary}\n\nThank you for shopping with us ❤️`
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
    const phone = clean(
      order.billing_address?.phone || order.shipping_address?.phone
    );

    const summary = buildOrderSummary(order);
    const status = order.financial_status || "N/A";

    if (phone) {
      await sendWA(
        phone,
        `🔄 *Order Update*\nYour order *${order.name}* has been updated.\n\n*Current Status:* ${status}\n\n${summary}`
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
    const phone = clean(
      order.billing_address?.phone || order.shipping_address?.phone
    );

    const summary = buildOrderSummary(order);
    const reason = order.cancel_reason || "N/A";

    if (phone) {
      await sendWA(
        phone,
        `❌ *Order Cancelled*\nYour order *${order.name}* has been cancelled.\n\n*Reason:* ${reason}\n\n${summary}\n\nIf this was a mistake, you can reorder anytime.`
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

// Order summary for WhatsApp messages
function buildOrderSummary(order) {
  const line = (order.line_items && order.line_items[0]) || {};
  const billing = order.billing_address || {};
  const shipping = order.shipping_address || {};

  const productTitle = line.title || "N/A";
  const variantTitle = line.variant_title || "";
  const qty = line.quantity || 1;
  const currency = order.currency || "INR";
  const total = order.total_price || "0.00";

  const email = order.email || "N/A";
  const phone = billing.phone || shipping.phone || "N/A";

  const addressLines = [
    shipping.name || billing.name,
    shipping.address1 || billing.address1,
    shipping.address2 || billing.address2,
    `${shipping.city || billing.city || ""}${
      shipping.city || billing.city ? "," : ""
    } ${shipping.province || billing.province || ""}`,
    `${shipping.zip || billing.zip || ""}`,
    shipping.country || billing.country || "India",
  ]
    .filter(Boolean)
    .join("\n");

  const status = order.financial_status || "N/A";
  const fulfillment = order.fulfillment_status || "unfulfilled";

  return `
• Product: ${productTitle}${
    variantTitle ? " (" + variantTitle + ")" : ""
  }
• Qty: ${qty}
• Total: ₹${total} ${currency}

• Order No: ${order.name || "N/A"}
• Email: ${email}
• Phone: ${phone}

• Payment Status: ${status}
• Fulfilment Status: ${fulfillment}

• Shipping Address:
${addressLines || "N/A"}
`.trim();
}

// -------------------------------------------
// ROOT
// -------------------------------------------
app.get("/", (req, res) =>
  res.send("COD OTP + Notifications Server (Render) Running ✔️")
);

// -------------------------------------------
// START SERVER + KEEP-ALIVE
// -------------------------------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Running on PORT", PORT);

  // KEEP SERVER AWAKE (Render free trick)
  setInterval(() => {
    fetch(`http://127.0.0.1:${PORT}/health`)
      .then(() =>
        console.log(
          "KeepAlive ping sent at",
          new Date().toLocaleTimeString("en-IN")
        )
      )
      .catch((err) => console.log("KeepAlive error:", err.message));
  }, 4 * 60 * 1000); // har 4 minute me ping
});
