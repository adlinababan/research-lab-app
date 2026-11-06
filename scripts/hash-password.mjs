// Membuat baris akun untuk env APP_USERS tanpa menyimpan password asli di Vercel.
// Pakai: node scripts/hash-password.mjs dosen01 "PasswordRahasia"
//   -> dosen01:sha256:<hex>   (tempel ke APP_USERS, satu akun per baris atau dipisah koma)
import crypto from "node:crypto";
const [user, pass] = process.argv.slice(2);
if (!user || !pass) { console.error('Pakai: node scripts/hash-password.mjs <username> "<password>"'); process.exit(1); }
console.log(`${user.trim().toLowerCase()}:sha256:${crypto.createHash("sha256").update(pass, "utf8").digest("hex")}`);
