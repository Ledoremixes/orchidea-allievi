function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const POSTER_MAP = [
  {
    match: ["bachata fusion", "fusion"],
    image: "/assets/corsi/bachata-fusion.png",
    accent: "fusion",
  },
  {
    match: ["bachata",],
    image: "/assets/corsi/bachata.png",
    accent: "latin",
  },
    {
    match: ["salsa",],
    image: "/assets/corsi/salsa.png",
    accent: "latin",
  },
    {
    match: ["primi passi",],
    image: "/assets/corsi/primi-passi.png",
    accent: "beginner",
  },
  {
    match: ["country"],
    image: "/assets/corsi/country.png",
    accent: "country",
  },
  {
    match: ["kizomba"],
    image: "/assets/corsi/kizomba.png",
    accent: "kizomba",
  },
];

export function getCourseVisual(course = {}) {
  const haystack = normalize(`${course?.nome || ""} ${course?.livello || ""}`);
  const matched = POSTER_MAP.find((item) => item.match.some((token) => haystack.includes(token)));

  return {
    image: matched?.image || "/assets/logo.png",
    accent: matched?.accent || "default",
  };
}
