import express from "express";
const app = express();
try { app.get("/*", (req, res) => res.send("ok")); console.log("/* works"); } catch (e) { console.error(e.message); }
try { app.get("/(.*)", (req, res) => res.send("ok")); console.log("/(.*) works"); } catch (e) { console.error(e.message); }
try { app.get("*splat", (req, res) => res.send("ok")); console.log("*splat works"); } catch (e) { console.error(e.message); }
