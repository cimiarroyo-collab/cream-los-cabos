import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const directory = new URL("../public/photos/", import.meta.url);
const escape = (value = "") => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const safeLink = value => /^(?:https?:\/\/|\/(?:photos|brand)\/)/i.test(String(value)) ? escape(value) : "";
const files = ["food/SOURCES.json", "drinks/SOURCES.json", "drinks/bar/SOURCES.json"];
const photographs = new Map();
for (const file of files) {
  let records;
  try { records = JSON.parse(await readFile(new URL(file, directory), "utf8")); }
  catch (error) { if (error.code === "ENOENT") continue; throw error; }
  const entries = Array.isArray(records) ? records : Object.values(records);
  for (const record of entries) {
    if (!record || typeof record.image !== "string") continue;
    const previous = photographs.get(record.image);
    if (!previous) photographs.set(record.image, record);
  }
}
const items = [...photographs.values()].map(record => {
  const source = safeLink(record.sourceURL);
  const license = safeLink(record.licenseURL);
  const title = escape(record.title || record.alt || record.image.split("/").pop());
  const credit = escape(record.author || record.creator || "Consultar fuente");
  const terms = escape(record.license || (record.generated ? "Referencia generada" : "Consultar fuente"));
  const changes = escape(record.modifications || record.adjustments || "");
  return `<li><h2>${source ? `<a href="${source}" rel="noopener noreferrer">${title}</a>` : title}</h2><p>${credit} · ${license ? `<a href="${license}" rel="noopener noreferrer">${terms}</a>` : terms}</p>${changes ? `<p>${changes}</p>` : ""}<code>${escape(record.image)}</code></li>`;
}).join("\n");
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fotografías y créditos · Cream Los Cabos</title><style>body{margin:0;background:#edebe3;color:#293b99;font:16px/1.7 system-ui,sans-serif}main{max-width:850px;padding:40px 24px;margin:auto}h1{font:42px/1.2 Georgia,serif}h2{font-size:16px;margin:0}a{color:inherit}li{padding:22px 0;border-bottom:1px solid #293b9926;list-style:none}ul{padding:0}p{margin:8px 0}code{font-size:12px;overflow-wrap:anywhere}.intro{max-width:650px}</style></head><body><main><a href="/club">Volver a Cream Club</a><h1>Fotografías y créditos.</h1><p class="intro">La identidad y las fotografías de Cream proceden de su web oficial. Las imágenes del catálogo son referencias de cada preparación; los créditos indican su procedencia y licencia. Las referencias generadas se identifican aquí.</p><p><a href="/brand/SOURCES.md">Recursos oficiales de la marca</a></p><ul>${items}</ul></main></body></html>`;
await writeFile(new URL("credits.html", directory), html);
console.log(`Créditos preparados: ${photographs.size} fotografías (${fileURLToPath(new URL("credits.html", directory))}).`);
