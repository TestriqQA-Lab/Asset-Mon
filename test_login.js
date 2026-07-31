const email = "op1405@plat.test";
const password = "DemoPass123";

fetch("http://localhost:4000/api/platform/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password })
})
  .then(res => res.text().then(text => ({ status: res.status, text })))
  .then(data => console.log(JSON.stringify(data, null, 2)))
  .catch(err => console.error(err));
