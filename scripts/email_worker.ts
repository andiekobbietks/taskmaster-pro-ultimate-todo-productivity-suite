/**
 * Cloudflare Email Worker — receives emails and forwards parsed data to taskmaster-pro.
 *
 * Setup:
 * 1. Create a domain on Cloudflare (or use an existing one)
 * 2. Go to Cloudflare Dashboard → Email → Email Routing
 * 3. Create a routing rule: hackathons@yourdomain.com → Send to Worker
 * 4. Deploy this Worker
 *
 * Dependencies:
 * - postal-mime (MIT license) — npm install postal-mime
 *
 * The Worker parses incoming emails, checks if the sender is a hackathon
 * platform, and POSTs the extracted data to the taskmaster-pro API.
 * Non-hackathon emails are forwarded to your personal inbox.
 */

import PostalMime from "postal-mime";

const HACKATHON_DOMAINS = [
  "devpost.com", "devpost.org",
  "mlh.io", "mlh.com",
  "kaggle.com",
  "lablab.ai",
  "ethglobal.com",
  "devfolio.co",
  "unstop.com",
  "hackerrank.com",
  "hackerearth.com",
];

const HACKATHON_KEYWORDS = [
  "hackathon", "competition", "challenge", "deadline",
  "submission", "prize",
];

export default {
  async email(message, env, ctx) {
    const email = await PostalMime.parse(message.raw);
    const sender = email.from?.address || "";
    const senderDomain = sender.split("@")[1] || "";

    const isPlatform = HACKATHON_DOMAINS.some(d => senderDomain.includes(d));
    const hasKeyword = HACKATHON_KEYWORDS.some(k =>
      (email.subject || "").toLowerCase().includes(k) ||
      (email.text || "").toLowerCase().includes(k)
    );

    const isHackathon = isPlatform || hasKeyword;

    if (isHackathon) {
      // POST to taskmaster-pro API
      const payload = {
        sender: sender,
        subject: email.subject || "",
        received_at: Date.now(),
        body_text: email.text || "",
        body_html: email.html || "",
        has_attachments: (email.attachments?.length || 0) > 0,
        attachment_names: email.attachments?.map(a => a.filename) || [],
        is_platform: isPlatform,
      };

      try {
        const resp = await fetch("https://yourdomain.com/api/inbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          console.error("Failed to post to taskmaster:", resp.status);
          await message.forward("you@gmail.com");
        }
      } catch (err) {
        console.error("Error posting to taskmaster:", err);
        await message.forward("you@gmail.com");
      }
    } else {
      // Forward non-hackathon emails to personal inbox
      await message.forward("you@gmail.com");
    }
  },
};
