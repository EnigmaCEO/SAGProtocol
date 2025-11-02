const { randomBytes } = require("crypto");

function generatePrivateKey() {
  const privateKey = randomBytes(32).toString("hex");
  console.log("Generated Private Key:", privateKey);
  console.log("Save this key to your .env file manually.");
}

generatePrivateKey();
generatePrivateKey();