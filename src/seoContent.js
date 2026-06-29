export const SITE_NAME = "Aotesys";
export const SITE_URL = "https://aotesys.com";
export const SITE_DOMAIN = "aotesys.com";
export const AUTHOR_NAME = "Karry Lim";
export const AUTHOR_TITLE = "Founder and author";
export const AUTHOR_EMAIL = "hello@aotesys.com";
export const UPDATED_DATE = "2026-06-29";
export const DEFAULT_IMAGE = "/aotesys-dashboard-preview.png";

export const ROUTE_METADATA = [
  {
    name: "home",
    path: "/",
    title: "Aotesys | AI Sales Assistant Workspaces for Business Websites",
    description:
      "Aotesys helps small businesses turn website questions into organized AI sales conversations, owner handoffs, and approved business knowledge.",
    navLabel: "Home",
    indexable: true
  },
  {
    name: "features",
    path: "/features",
    title: "Aotesys Features | AI Chat Channels, Owner Handoff and Knowledge",
    description:
      "Explore Aotesys features for AI website inquiries, workspace subdomains, prompt control, visitor conversations, and safe owner follow-up.",
    navLabel: "Features",
    indexable: true
  },
  {
    name: "resources",
    path: "/resources",
    title: "Aotesys Resources | AI Sales Assistant Guides by Karry Lim",
    description:
      "Read practical Aotesys resources on AI sales assistants, website inquiry handling, business knowledge prompts, and customer handoff workflows.",
    navLabel: "Resources",
    indexable: true
  },
  {
    name: "guide",
    path: "/resources/ai-sales-assistant-guide",
    title: "How an AI Sales Assistant Should Handle Website Inquiries",
    description:
      "Karry Lim explains how small businesses can use an AI sales assistant without inventing facts, losing leads, or overwhelming staff.",
    navLabel: "AI sales guide",
    indexable: true
  },
  {
    name: "about",
    path: "/about",
    title: "About Aotesys | Built by Karry Lim for Practical Sales Support",
    description:
      "Learn why Karry Lim created Aotesys, what the platform is designed to do, and how it keeps AI sales support grounded in approved business facts.",
    navLabel: "About",
    indexable: true
  },
  {
    name: "contact",
    path: "/contact",
    title: "Contact Aotesys | Ask About AI Sales Assistant Workspaces",
    description:
      "Contact Aotesys for product questions, workspace support, partnership inquiries, or help setting up an AI sales assistant for your business.",
    navLabel: "Contact",
    indexable: true
  },
  {
    name: "privacy",
    path: "/privacy",
    title: "Privacy Policy | Aotesys",
    description:
      "Read the Aotesys privacy policy for website visitors, workspace owners, and users of Aotesys AI sales assistant tools.",
    navLabel: "Privacy",
    indexable: true
  },
  {
    name: "terms",
    path: "/terms",
    title: "Terms of Service | Aotesys",
    description:
      "Read the Aotesys terms of service for workspace owners, website visitors, and users of the Aotesys sales support platform.",
    navLabel: "Terms",
    indexable: true
  },
  {
    name: "signup",
    path: "/signup",
    title: "Create an Aotesys Workspace",
    description:
      "Create an Aotesys workspace for your business and prepare shareable AI sales chat channels.",
    navLabel: "Sign up",
    indexable: false
  },
  {
    name: "login",
    path: "/login",
    title: "Aotesys Workspace Login",
    description:
      "Log in to an Aotesys workspace to manage visitor conversations, channel prompts, and sales handoffs.",
    navLabel: "Login",
    indexable: false
  },
  {
    name: "public-chat",
    path: "/chat/",
    title: "Aotesys Public Chat",
    description:
      "A shared Aotesys public chat channel for business visitor questions.",
    navLabel: "Public chat",
    indexable: false
  },
  {
    name: "not-found",
    path: "/404",
    title: "Page Not Found | Aotesys",
    description:
      "This Aotesys page does not exist. Use the navigation to return to real product, support, and policy pages.",
    navLabel: "Page not found",
    indexable: false
  }
];

export const MARKETING_NAV = [
  { route: "features", label: "Features" },
  { route: "resources", label: "Resources" },
  { route: "about", label: "About" },
  { route: "contact", label: "Contact" }
];

export const FOOTER_LINKS = [
  { route: "privacy", label: "Privacy" },
  { route: "terms", label: "Terms" },
  { route: "contact", label: "Contact" }
];

export const INDEXABLE_ROUTE_METADATA = ROUTE_METADATA.filter(
  (route) => route.indexable
);

const metadataByName = new Map(ROUTE_METADATA.map((route) => [route.name, route]));
const metadataByPath = new Map(ROUTE_METADATA.map((route) => [route.path, route]));

export function normalizePathname(pathname) {
  const cleanPath = String(pathname || "/").split("?")[0].split("#")[0];

  if (!cleanPath || cleanPath === "/") {
    return "/";
  }

  return cleanPath.replace(/\/+$/, "");
}

export function getPageMetadataByName(name) {
  return metadataByName.get(name) || metadataByName.get("not-found");
}

export function getPageMetadataByPath(pathname) {
  const normalizedPath = normalizePathname(pathname);

  if (normalizedPath.startsWith("/chat/")) {
    return metadataByName.get("public-chat");
  }

  return metadataByPath.get(normalizedPath);
}

export function getRouteNameByPath(pathname) {
  return getPageMetadataByPath(pathname)?.name || "not-found";
}

export function getCanonicalUrl(routeName) {
  const metadata = getPageMetadataByName(routeName);
  const path = metadata?.indexable ? metadata.path : "/";

  return `${SITE_URL}${path === "/" ? "/" : path}`;
}

export function getStructuredData(routeName) {
  const metadata = getPageMetadataByName(routeName);
  const canonicalUrl = getCanonicalUrl(routeName);
  const graph = [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/favicon.png`,
      founder: {
        "@type": "Person",
        name: AUTHOR_NAME,
        jobTitle: AUTHOR_TITLE
      },
      description:
        "Aotesys builds AI sales assistant workspaces for small businesses that need safer website inquiry handling, owner handoff, and approved business knowledge.",
      email: AUTHOR_EMAIL
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      publisher: {
        "@id": `${SITE_URL}/#organization`
      },
      inLanguage: "en"
    },
    {
      "@type": "WebPage",
      "@id": `${canonicalUrl}#webpage`,
      url: canonicalUrl,
      name: metadata.title,
      description: metadata.description,
      isPartOf: {
        "@id": `${SITE_URL}/#website`
      },
      about: {
        "@id": `${SITE_URL}/#organization`
      },
      author: {
        "@type": "Person",
        name: AUTHOR_NAME
      },
      dateModified: UPDATED_DATE,
      inLanguage: "en"
    },
    getBreadcrumbSchema(routeName)
  ];

  if (routeName === "features") {
    graph.push({
      "@type": "SoftwareApplication",
      name: SITE_NAME,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: `${SITE_URL}/features`,
      description:
        "Aotesys gives each business a workspace for AI website inquiries, shareable chat channels, owner replies, and approved knowledge prompts."
    });
  }

  if (routeName === "contact") {
    graph.push({
      "@type": "ContactPage",
      url: `${SITE_URL}/contact`,
      name: "Contact Aotesys",
      email: AUTHOR_EMAIL
    });
  }

  if (routeName === "guide") {
    graph.push({
      "@type": "Article",
      headline: "How an AI Sales Assistant Should Handle Website Inquiries",
      description: metadata.description,
      image: `${SITE_URL}${DEFAULT_IMAGE}`,
      datePublished: UPDATED_DATE,
      dateModified: UPDATED_DATE,
      author: {
        "@type": "Person",
        name: AUTHOR_NAME
      },
      publisher: {
        "@id": `${SITE_URL}/#organization`
      },
      mainEntityOfPage: {
        "@id": `${canonicalUrl}#webpage`
      }
    });
  }

  return {
    "@context": "https://schema.org",
    "@graph": graph
  };
}

function getBreadcrumbSchema(routeName) {
  const metadata = getPageMetadataByName(routeName);
  const crumbs = [
    {
      "@type": "ListItem",
      position: 1,
      name: SITE_NAME,
      item: `${SITE_URL}/`
    }
  ];

  if (metadata.path !== "/") {
    crumbs.push({
      "@type": "ListItem",
      position: 2,
      name: metadata.navLabel,
      item: getCanonicalUrl(routeName)
    });
  }

  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs
  };
}
