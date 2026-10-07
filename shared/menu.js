// Catalog transcribed from the public Cream menu. Missing prices stay null.
// Existing, configured prices are merged separately by shared/catalog.js.
export const MENU_SOURCE = {
  title: "Menú oficial de Cream Café Los Cabos",
  url: "https://www.creamcafeloscabos.com/cream-menu",
  lastPublished: "2026-09-04",
  retrievedAt: "2026-10-07",
  pricesPublished: false,
};

const slug = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const images = { Desayunos: "desayunos", Comida: "comida", Café: "cafe", Bebidas: "bebidas", Bar: "bar", Vinos: "vinos" };
const entries = (category, section, rows, station) => rows.map(([name, description, id]) => ({
  id: id ?? slug(name), name, category, section,
  station: station ?? (["Desayunos", "Comida"].includes(category) ? "Cocina" : "Barra"),
  price: null, description, options: [], image: `/images/menu-${images[category]}.svg`,
}));
const named = (category, section, names, description) => entries(category, section, names.map((name) => [name, description ?? `${section}: ${name}.`]));
const choice = (id, label, values) => ({ id, label, values: values.map(([optionId, optionLabel, price = null]) => ({ id: optionId, label: optionLabel, price })) });
const milk = (withoutMilk = false) => choice("milk", "Leche", [
  ...(withoutMilk ? [["none", "Sin leche", 0]] : []),
  ["whole", "Entera"], ["lactose-free", "Deslactosada"], ["oat", "Avena"], ["almond", "Almendra"], ["coconut", "Coco"],
]);
const crepeIngredients = [
  ["chocolate", "Salsa de chocolate"], ["cajeta", "Cajeta"], ["hazelnut", "Crema de avellana"],
  ["walnuts", "Nueces"], ["berries", "Frutos rojos"], ["banana", "Plátano"], ["whipped-cream", "Crema batida"],
  ["cream-cheese", "Queso crema"], ["coconut", "Coco rallado"], ["chocolate-chips", "Chispas de chocolate"],
];

export const OFFICIAL_PRODUCTS = [
  ...entries("Desayunos", "Especiales de desayuno", [
    ["Enchiladas Suizas", "Tortillas rellenas de pollo con salsa verde cremosa y mozzarella."],
    ["Tetela de milpa", "Masa nixtamalizada con mozzarella y chicharrón; guajillo y quelites."],
    ["Shakshuka Eggs", "Huevos pochados en salsa de tomate, pimientos y especias con hierbas frescas."],
    ["Three Cheese Molletes", "Baguette con frijoles, pico de gallo, salsa verde y aguacate."],
    ["Chilaquiles", "Salsa roja o verde, mozzarella, crema, frijoles y aguacate."],
  ]),
  ...entries("Desayunos", "Desayunos saludables", [
    ["House Muesli", "Avena con yogur griego, fruta, arándanos y semillas de cáñamo."],
    ["Açaí Bowl", "Açaí orgánico con frutos rojos, plátano, granola de la casa, coco y chía."],
    ["Tropical Chia Pudding", "Chía con coco, yogur griego, mermelada de temporada y cardamomo."],
    ["Signature Fruit Bowl", "Fruta de temporada con yogur griego, granola de la casa y miel."],
  ]),
  ...entries("Desayunos", "Desayunos dulces", [
    ["Buttermilk Pancakes", "Pancakes con tocino ahumado, mantequilla y jarabe de maple."],
    ["Cream French toast", "Tostada francesa con manzana, mascarpone, pistache y estragón."],
  ]),
  ...entries("Desayunos", "Huevos y burritos", [
    ["Bandera Omelette", "Omelette con tocino, champiñones, cheddar, dos salsas y frijoles."],
    ["Egg-White Omelette", "Claras con espinaca, queso de cabra y cebolla caramelizada; ensalada y aguacate."],
    ["Huevos Rancheros Divorciados", "Huevos sobre tortillas con jamón de pavo, dos salsas, frijoles y aguacate."],
    ['Eggs with Machaca "Choyera"', "Huevos con machaca de Miraflores, verduras, panela y tortillas de harina."],
    ["Eggs and style", "Huevos al gusto con tocino o jamón, frijoles, panela asada y pan tostado."],
    ["Breakfast Bun", "Brioche con huevo, tocino, jamón de pavo, queso suizo y aguacate; papas o ensalada."],
    ["Burrito Cream", "Burrito de huevo, cheddar, tocino y aguacate; papas o ensalada."],
  ]),
  ...entries("Desayunos", "Tostadas y bagels", [
    ["Avocado Toast", "Masa madre con huevos pochados, aguacate, arúgula y salsa macha."],
    ["Prosciutto & Parmesan Toast", "Masa madre con huevo revuelto, aguacate, prosciutto y parmesano; ensalada."],
    ["Smoked Salmon Bagel", "Bagel de salmón ahumado con queso crema, arúgula, alcaparras y aguacate."],
  ]),
  ...entries("Comida", "Pizzas", [
    ["Pepperoni", "Pizza con salsa napolitana, mozzarella y pepperoni."],
    ["Margarita Pizza", "Pizza con salsa napolitana, mozzarella, tomate y albahaca."],
    ["Prosciutto & Arugula Pizza", "Prosciutto y arúgula con mozzarella, queso de cabra y parmesano."],
    ["Meat Pizza", "Res, salami, pepperoni, salchicha, champiñones y cebolla morada."],
    ["Pear & Gorgonzola Pizza", "Pizza con salsa Alfredo, pera, gorgonzola, mozzarella y nuez de la India."],
    ["Make Your Own Pizza", "Base de salsa napolitana y mozzarella para elegir ingredientes de la carta."],
  ]),
  ...entries("Comida", "Entradas", [
    ["Mac & Cheese", "Macarrones con salsa cheddar y parmesano."],
    ["Boneless Buffalo Chicken", "Bocados de pollo con salsa Buffalo."],
    ["Truffle Fries", "Papas crujientes con parmesano y aceite de trufa."],
    ["Guacamole de la Casa", "Guacamole con pico de gallo, panela, cilantro y pepitas."],
  ]),
  ...entries("Comida", "Pastas", [
    ["Lasagna", "Lasagna con boloñesa, salsa Alfredo, mozzarella y parmesano."],
    ["Spaghetti alla Bolognesa", "Spaghetti con boloñesa, parmesano y pesto."],
    ["Linguini Fra Diavolo", "Linguini con camarón, pomodoro, chile, espinaca, piñones y feta."],
    ["Portobello Pesto Fussili", "Fusilli con pesto, hongos de temporada, tomate cherry y parmesano."],
    ["Fettuccine Alfredo", "Fettuccine con salsa Alfredo, parmesano y aceite de trufa."],
  ]),
  ...entries("Comida", "Sopas", [
    ["Garden vegetable soup", "Caldo de tomate con verduras, frijoles blancos y espinaca."],
    ["Roasted tomato soup", "Sopa de tomate rostizado con pesto de albahaca."],
  ]),
  ...entries("Comida", "Ensaladas y bowls", [
    ["Roasted beets", "Betabel con queso de cabra, arúgula, naranja y pistaches."],
    ["Cesar Salad", "Lechuga romana con aderezo César, parmesano y crutones ahumados."],
    ["Buddha Bowl", "Hojas y verduras con lentejas, quinoa y aderezo de cúrcuma."],
    ["Avocado Salad", "Hojas de Miraflores con tomate, aceitunas, manchego y aderezo de aguacate."],
    ["Cobb Salad", "Ensalada con pollo, tocino, huevo, aguacate, panela y aderezo ranch."],
    ["Ensalada Verde", "Hojas de Miraflores con pepino, uvas, brócoli, menta y pistaches."],
    ["Cabo Bowl", "Bowl con pollo, arroz, frijoles negros, camote, maíz y aguacate."],
  ]),
  ...entries("Comida", "Platos fuertes", [
    ["Cheeseburger", "Hamburguesa de res de 200 g con cheddar y cebolla caramelizada; papas."],
    ["Buffalo Chicken Burger", "Pollo frito de 200 g en brioche con queso suizo y pepino; papas."],
    ["Club Sandwich", "Pan tostado con pollo, jamón de pavo, queso suizo, tocino y aguacate; papas."],
    ["Beef Tacos", "Tres tacos de res con costra de mozzarella, aguacate, salsa verde y pico de gallo."],
    ["Wood oven salmon", "Salmón al horno con tomate, quinoa, pistache y tzatziki de pepino."],
    ["Breaded chicken breast · 350 g", "Pechuga empanizada con ensalada de pepino e hinojo y aderezo ranch.", "breaded-chicken-breast"],
  ]),
  ...entries("Comida", "Menú infantil", [
    ["Breaded chicken breast · Infantil", "Pechuga empanizada de 200 g con papas.", "breaded-chicken-breast-kids"],
    ["Mini Cheese Pizza", "Pizza infantil con salsa de tomate y mozzarella."],
  ]),
  ...entries("Comida", "Postres", [
    ["Affagato", "Postre de la carta de Cream."],
    ["Greek Yogurt Ice Cream", "Helado de yogur griego."],
    ["Passion fruit cheesecake", "Cheesecake con salsa de maracuyá y frutos rojos."],
    ["CreamyFlan", "Flan cremoso con frutos rojos."],
  ], "Panadería"),
  ...entries("Comida", "Crepas", [
    ["La Favorita", "Crepa con cajeta, plátano y nuez pecana."],
    ["La Clásica", "Crepa con mascarpone, queso crema y frutos rojos."],
    ["La Especial", "Crepa con jamón, Gouda y salsa de fresa con chipotle."],
    ["Make Your Own Crepes", "Elige dos ingredientes de la lista publicada para tu crepa."],
  ]),
  ...entries("Café", "Espresso bar", [
    ["Espresso 2 oz", "Espresso; presentación de 2 oz."],
    ["Macchiato 2.5 oz", "Macchiato; presentación de 2.5 oz."],
    ["Flat White", "Flat White; presentación de 5 oz.", "flat-white"],
    ["Bullet Proof 12 oz", "Bullet Proof; presentación de 12 oz."],
    ["Americano 12 oz", "Americano; presentación de 12 oz."],
    ["Americanito 8 oz", "Americanito; presentación de 8 oz."],
    ["Latte 12 oz", "Latte; presentación de 12 oz."],
    ["Capuccino 2 oz", "Capuccino; presentación de 2 oz, tal como figura en la carta."],
  ]),
  ...entries("Café", "Frappés", [
    ["Frappé Café", "Frappé de café.", "frappe-cafe"],
    ["Frappé Matcha", "Frappé de matcha.", "frappe-matcha"],
    ["Frappé Mocha", "Frappé de mocha.", "frappe-mocha"],
    ["Frappé Oreo", "Frappé de Oreo.", "frappe-oreo"],
    ["Frappé Matcha Mint", "Frappé de matcha con menta.", "frappe-matcha-mint"],
    ["Frappé Chai", "Frappé de chai.", "frappe-chai"],
    ["Frappé Vainilla", "Frappé de vainilla.", "frappe-vainilla"],
    ["Frappé Caramelo", "Frappé de caramelo.", "frappe-caramelo"],
  ]),
  ...entries("Café", "Especiales de café", [
    ["Moccha", "Moccha de la barra de café."],
    ["Chai Latte", "Chai latte de la barra de café."],
    ["Dirty chai", "Dirty chai de la barra de café."],
    ["Matcha latte", "Matcha latte de la barra de café."],
    ["Cacao with vanilla", "Cacao con vainilla."],
    ["Cacao with cardamom", "Cacao con cardamomo, Jangala de Chiapas."],
    ["Coffee of the day", "Mezcla de café de Chiapas, Veracruz y Oaxaca."],
  ]),
  ...entries("Café", "Café frío", [
    ["Tonic 10 oz", "Tonic de la barra de café; presentación de 10 oz."],
    ["Cold Brew 16 oz", "Cold brew; presentación de 16 oz."],
    ["Carajillo 10 oz", "Carajillo; presentación de 10 oz.", "carajillo-10-oz"],
    ["Espresso Martini 8 oz", "Espresso Martini; presentación de 8 oz.", "espresso-martini-8-oz"],
  ]),
  ...entries("Bebidas", "Smoothies", [
    ["Rojo Amor", "Frutos rojos, espirulina y dátiles con leche de almendra de la casa."],
    ["Cabo Sunshine", "Mango, fresa, piña y goji con agua de coco orgánica."],
    ["Post Workout", "Arándano, plátano, espinaca, crema de cacahuate y leche de almendra."],
    ["Ayurvedic Smoothie", "Arándano, aguacate, kale, jengibre, miel y agua de coco."],
    ["Coffee cream", "Cold brew con avena, plátano, dátiles, maca y leche de almendra."],
    ["Go green", "Kale, espinaca, manzana verde, plátano y maca con leche de almendra."],
  ]),
  ...entries("Café", "Tés", [
    ["Earl grey", "Té Earl grey.", "te-earl-grey"], ["Sencha", "Té Sencha.", "te-sencha"],
    ["Green ginger & lemon", "Té verde con jengibre y limón.", "te-green-ginger-lemon"],
    ["Detox", "Té Detox.", "te-detox"], ["Tchaikovsky", "Té Tchaikovsky.", "te-tchaikovsky"],
    ["Oma' s garden", "Té Oma's garden.", "te-oma-s-garden"], ["Guava", "Té de guayaba.", "te-guava"],
    ["Mango", "Té de mango.", "te-mango"], ["Cinnamon almonds", "Té de canela y almendras.", "te-cinnamon-almonds"],
  ]),
  ...entries("Bebidas", "Jugos", [
    ["Orange Juice", "Jugo de naranja."], ["Red Juice", "Jugo de betabel, naranja y zanahoria."],
    ["Green Juice", "Espinaca, apio, manzana verde, jengibre, pepino y perejil."],
  ]),
  ...entries("Bebidas", "Shots de bienestar", [["Signature Ginger Shot", "Jengibre, lima, miel y cúrcuma."]]),
  ...named("Bebidas", "Refrescos", [
    "Coca Cola 355 ml", "Sprite 355 ml", "Fanta 355 ml", "Sidral Mundet 355 ml", "Kombucha",
    "Coca Cola Light 355 ml", "Fresca 355 ml", "Felix", "Ginger ale", "Homemade Natural Sodas",
  ], "Refresco de la carta de Cream; presentación indicada cuando está publicada."),
  ...named("Bebidas", "Aguas", [
    "Agua Ciel 600 ml", "Topo Chico 750 ml", "Topo Chico 355 ml", "Agua de Piedra Still 360 ml", "Agua de Piedra Still 650 ml", "Coconut Water Nirvan",
  ], "Agua de la carta de Cream; presentación indicada cuando está publicada."),
  ...named("Bebidas", "Cocteles sin alcohol", ["Pineapple Lemonade", "Coconut Lemonade", "Lychee Collins"], "Coctel sin alcohol de la carta de Cream."),
  ...entries("Bar", "Cocteles de autor", [
    ["Cabo Garden Mezcalita", "Mezcal con albahaca, limón, jarabe de agave y romero."],
    ["Tonica California", "Gin con salvia, hierbas, té butterfly pea, tónica y cítricos."],
    ["Cream Classic Margarita", "Tequila blanco, agave, triple sec, limón, lima y sal artesanal."],
    ["Espresso Marcreami", "Ron oscuro, licor de café, piña, espresso y bitters de ruda."],
    ["Palpiña", "Tequila blanco, cítricos, licor Ancho Reyes y aceite de ajonjolí."],
  ]),
  ...named("Bar", "Cocteles clásicos", [
    "Aperol Spritz", "Mint Julep", "Cosmopolitan", "Bees Knees", "Paloma", "Daiquiri", "Margarita", "Margarita Cadillac", "Bloody Mary", "Mojito",
    "Bellini", "Mimosa", "Negroni", "Manhattan", "Piña colada", "Sangria", "Old Fashioned", "Clerico", "Dry or Dirty", "Martini", "Tonic Brew", "Espresso Martini", "Carajillo",
  ], "Coctel clásico de la carta de Cream."),
  ...named("Bar", "Tequila", [
    "Clase Azul Reposado", "Código Añejo", "Código Blanco", "Código Reposado", "Código Rosa", "Don Julio 70", "Don Julio Blanco", "Don Julio Reposado", "Casa Amigos Blanco", "Casa Amigos Reposado",
  ]),
  ...named("Bar", "Mezcal y sotol", ["400 Conejos", "Unión Jóven", "Sotol Coyote", "Unión Viejo"]),
  ...named("Bar", "Gin", ["Bombay", "Tanqueray", "Hendricks", "Beefeater"]),
  ...named("Bar", "Whisky", ["Crown Royal", "JW Red Label", "JW Black Label", "Maker s Mark", "Macallan 12y", "Macallan 18Y", "Jack Daniels"]),
  ...named("Bar", "Vodka", ["Absolut", "Grey Goose", "Smirnoff", "Belvedere", "Ketel One", "Titos"]),
  ...named("Bar", "Ron", ["Bacardi", "Havana 7", "Captain Morgan"]),
  ...named("Bar", "Cervezas", [
    "Corona 355 ml", "Pacifico 355 ml", "Stella artois 330 ml", "Corona light 355 ml", "Victoria 355 ml", "Michelob 355 ml", "Cielito lindo lager mexicana", "Cielito lindo IPA 355 ml",
  ], "Cerveza de la carta de Cream; presentación indicada cuando está publicada."),
  ...named("Bebidas", "Bebidas sin alcohol", ["Arnold palmer", "Buffalo green"], "Bebida sin alcohol de la carta de Cream."),
  ...entries("Vinos", "Tintos por copa y botella", [
    ["Stone Valley", "Cabernet Sauvignon de California, Estados Unidos; botella de 750 ml."],
    ["Barterose Bertani", "Merlot de Veneto, Italia; botella de 750 ml."],
    ["Angeline", "Pinot Noir de California, Estados Unidos; botella de 750 ml."],
    ["Folie a Deux", "Cabernet Sauvignon de Alexander Valley, Estados Unidos; botella de 750 ml."],
  ]),
  ...entries("Vinos", "Blancos por copa y botella", [
    ["Postcard", "Pinot Grigio de Veneto, Italia; botella de 750 ml."],
    ["Hess Select Chardonnay", "Chardonnay de Monterey County, Estados Unidos; botella de 750 ml."],
    ["12 E Mezzo bio", "Mezcla de Puglia, Italia; botella de 750 ml."],
  ]),
  ...entries("Vinos", "Espumosos por copa y botella", [["Espuma de Mar Brut", "Freixenet de Querétaro, México; botella de 750 ml."]]),
  ...entries("Vinos", "Selección del sommelier", [
    ["Twomey Sauvigon blanc", "Sauvignon Blanc de Napa Valley y Sonoma; botella de 750 ml."],
    ["Post & Beam by Far Niente", "Chardonnay de Carneros, Napa Valley, Estados Unidos; botella de 750 ml."],
    ["The Prisioner", "Mezcla tinta de Napa Valley, Estados Unidos; botella de 750 ml."],
    ["Duckhorn Merlot", "Merlot de Napa Valley, Estados Unidos; botella de 750 ml."],
    ["Daou Reserve", "Cabernet Sauvignon de Paso Robles, Estados Unidos; botella de 750 ml."],
  ]),
  ...entries("Vinos", "Rosados por copa y botella", [["Tres Raices Rosé", "Grenache y Caladoc de Dolores Hidalgo, México; botella de 750 ml."]]),
  ...entries("Vinos", "Vinos de la casa", [
    ["Espuma de Mar", "Ezequiel Montes, México."],
    ["Casa Madero V Rose", "Valle de Parras, México."],
    ["Velante Pinot Grigio", "Friuli Venezia, Italia."],
    ["Corona del Valle Sauvignon Blanc", "Valle de Guadalupe, México."],
    ["Blanco Puro Chardonnay", "California, Estados Unidos."],
    ["Bouchard Heritage du Conseiller Pinot Noir", "Bourgogne, Francia."],
    ["Vernaiolo Chianti", "Toscana, Italia."],
    ["Rojo Vivo", "California, Estados Unidos."],
  ]),
  ...entries("Vinos", "Espumosos", [
    ["Champagne Moet Imperial", "Francia; botella de 375 ml."],
    ["Espuma del Mar Rose", "México; botella de 750 ml."],
    ["Bortolomio Miol Prosecco", "Italia; botella de 750 ml."],
  ]),
  // The source labels this block ROSÉ but explicitly lists white varietals.
  ...entries("Vinos", "Blancos", [
    ["Duckhorn Sauvignon Blanc", "Estados Unidos."],
    ["Tres Raíces Crianza Sauvignon Blanc", "México."],
    ["Lucien Crochet Sancerre “Les Calcaires”", "Francia."],
    ["Von Win Riesling", "Alemania."],
    ["Nivarius Tempranillo Blanco", "Bourgogne, España, según la carta."],
    ["Tommasi Pinot Grigio", "Italia."],
    ["J. Moreau & Fils Chablis", "Francia."],
    ["Casa Madero 2V", "México."],
    ["Post & Beam Chardonnay by Farniente", "Estados Unidos."],
    ["Daou Chardonnay, Pasa Robles", "Estados Unidos."],
  ]),
  ...entries("Vinos", "Rosados", [
    ["Petale de Rose", "Francia; botella de 375 ml."], ["Rumor Rose", "Francia; botella de 750 ml."],
  ]),
  ...entries("Vinos", "Tintos", [
    ["Duckhorn Decoy Cabernet Sauvignon", "Estados Unidos."],
    ["Daou Reserva Cabernet Sauvignon", "Estados Unidos."],
    ["Daou Cabernet Sauvignon", "Estados Unidos."],
    ["Post & Beam Cabernet Sauvigon", "Estados Unidos."],
    ["Rojo Vivo Reserva Cabernet Sauvignon", "México."],
    ["Monteori Cabernet Sauvignon-Sangiovese", "México."],
    ["Napa Cellar Merlot", "Estados Unidos."],
    ["Lucente", "Italia."],
    ["Roganto Nebbiolo de la Baja", "México."],
    ["Psi de Pingus Tempranillo", "España."],
    ["Altos Las Hormigas Terroir Malbec", "Argentina."],
    ["Terrazas Reserva Malbec", "Argentina."],
    ["Clos de los 7 Malbec", "Argentina."],
    ["Duckhorn Goldeneye Pinot", "Estados Unidos."],
    ["Calera Pinot Noir", "Estados Unidos."],
    ["Encinillas Megacero Blend", "México."],
    ["Emeve Shiraz", "México."],
  ]),
  ...entries("Vinos", "Oportos", [
    ["Oporto Grahams 10 años", "Portugal; botella de 375 ml."], ["Oporto Grahams 20 años", "Portugal; botella de 375 ml."],
  ]),
];

const blackCoffeeIds = new Set(["espresso-2-oz", "americano-12-oz", "americanito-8-oz", "coffee-of-the-day", "bullet-proof-12-oz"]);

for (const product of OFFICIAL_PRODUCTS) {
  if (["Espresso bar", "Frappés", "Especiales de café"].includes(product.section)) product.options = [milk(blackCoffeeIds.has(product.id))];
  if (product.id === "chilaquiles") product.options = [
    choice("sauce", "Salsa", [["green", "Verde", 0], ["red", "Roja", 0]]),
    choice("protein", "Proteína extra", [
      ["none", "Sin extra", 0], ["eggs", "Huevos"], ["chicken", "Pollo"], ["cochinita", "Cochinita pibil"],
      ["chorizo", "Chorizo"], ["beef", "Res"], ["shrimp", "Camarón"],
    ]),
  ];
  if (product.id === "make-your-own-pizza") product.options = [
    choice("vegetable", "Vegetal extra", [
      ["none", "Sin extra", 0], ["cherry-peppers", "Cherry peppers"], ["red-onion", "Cebolla morada"], ["basil", "Albahaca"],
      ["arugula", "Arúgula"], ["pineapple", "Piña"], ["tomato", "Tomate"], ["cherry-tomato", "Tomate cherry"], ["mushroom", "Champiñón"], ["avocado", "Aguacate"],
    ]),
    choice("topping", "Ingrediente extra", [
      ["none", "Sin extra", 0], ["salami", "Salami"], ["pepperoni", "Pepperoni"], ["prosciutto", "Prosciutto"], ["bacon", "Tocino"],
      ["green-olives", "Aceitunas verdes"], ["black-olives", "Aceitunas negras"], ["sausage", "Salchicha"],
    ]),
    choice("protein", "Proteína extra", [["none", "Sin extra", 0], ["beef", "Res"], ["shrimp", "Camarón"]]),
  ];
  if (product.id === "make-your-own-crepes") product.options = [
    choice("ingredient-one", "Primer ingrediente", crepeIngredients),
    choice("ingredient-two", "Segundo ingrediente", crepeIngredients),
  ];
  if (product.category === "Vinos") product.options = [
    choice("presentation", "Presentación", (product.section.includes("por copa") || product.section === "Vinos de la casa")
      ? [["glass", "Copa"], ["bottle", "Botella"]] : [["bottle", "Botella"]]),
  ];
}
