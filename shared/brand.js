// Public information published on the official Cream Los Cabos website.
export const WEBSITE_URL = "https://www.creamcafeloscabos.com/index";

const HOURS = "7:00 a. m. – 10:00 p. m.";
const mapSearch = (query) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

export const BRANCH_INFO = {
  Palmilla: {
    name: "The Shoppes at Palmilla",
    address: "Palmilla, San José del Cabo, 23400, Baja California Sur, México",
    hours: HOURS,
    mapUrl: mapSearch("Cream Café The Shoppes at Palmilla, San José del Cabo, México"),
  },
  "Ánima Village": {
    name: "Cabo del Sol · Ánima Village",
    address: "Cabo del Sol, Corredor Turístico, Los Cabos, 23455, Baja California Sur, México",
    hours: HOURS,
    mapUrl: mapSearch("Cream Café Ánima Village, Cabo del Sol, Los Cabos, México"),
  },
};

// The website lists these as general contact numbers, without a branch assignment.
export const CONTACT_PHONES = ["624 144 5279", "624 172 6160"];
