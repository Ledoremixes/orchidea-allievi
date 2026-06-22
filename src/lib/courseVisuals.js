function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function getCourseVisual(course = {}) {
  const haystack = normalize(`${course?.nome || ""} ${course?.livello || ""}`);

  if (haystack.includes("country") && haystack.includes("base")) {
    return { image: "/assets/corsi/country-base.png", accent: "country-base" };
  }
  if (haystack.includes("country")) {
    return { image: "/assets/corsi/country.png", accent: "country" };
  }
  if (haystack.includes("bachata fusion") || haystack.includes("fusion")) {
    return { image: "/assets/corsi/bachata-fusion.png", accent: "fusion" };
  }
  if (haystack.includes("kizomba")) {
    return { image: "/assets/corsi/kizomba.png", accent: "kizomba" };
  }
  if (haystack.includes("bachata") || haystack.includes("bachata") || haystack.includes("caraibico")) {
    return { image: "/assets/corsi/bachata.png", accent: "latin" };
  }

  if (haystack.includes("salsa") || haystack.includes("salsa") || haystack.includes("caraibico")) {
    return { image: "/assets/corsi/salsa.png", accent: "latin" };
  }
  if (haystack.includes("primi passi") || haystack.includes("caraibico")) {
    return { image: "/assets/corsi/primi-passi.png", accent: "latin" };
  }
  return { image: "/assets/logo.png", accent: "default" };
}
