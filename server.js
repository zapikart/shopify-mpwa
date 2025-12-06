const express = require("express");
const fetch = require("node-fetch");
const app = express();

app.use(express.json());

// ===== MPWA CONFIG =====
const MPWA_API_KEY = "s4b0g3qxsT0pUHPTtnES0KnFsAyROX";
const MPWA_SENDER = "918920700554"; // WhatsApp number

// ===== Shopify Webhook =====
app.post("/order", async (req, res) => {
  const order = req.body;
  console.log("Shopify order received");

  const addr = order.billing_address || order.shipping_address || {};
  const phone = addr.phone || (order.customer && order.customer.phone);
  if (!phone) {
    console.log("No phone number in order");
    return res.send("No phone");
  }

  const cleanPhone = phone.replace(/[^0-9]/g, "");

  const msg = `🎉 *Order Confirmed!*

Hello *${addr.first_name || "Customer"}*,
Your order *${order.name}* is confirmed.

Total Amount: ₹${order.total_price}

Thank you for shopping with us!`;

  const payload = {
    api_key: MPWA_API_KEY,
    sender: MPWA_SENDER,
    number: cleanPhone,
    message: msg,
    footer: "Sent via MPWA",
  };

  try {
    const response = await fetch("https://codesai.dev/send-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log("MPWA Response:", data);
    res.send("ok");
  } catch (e) {
    console.error("MPWA error:", e);
    res.status(500).send("error");
  }
});

app.get("/", (req, res) => res.send("MPWA + Shopify server working ✅"));

// ⬇️ yaha port Railway/Render ka env use karega
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
