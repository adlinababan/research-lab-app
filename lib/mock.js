// Data uji untuk MOCK=1 (hanya untuk pengujian lokal, bukan untuk pelatihan).
// Semua judul diberi label "DATA UJI" dan DOI 10.0000/... agar tidak tertukar dengan literatur nyata.

export function mockSearch(query) {
  const topics = ["persepsi konsumen", "ekspor UMKM", "desain kemasan", "analisis sentimen", "e-commerce lintas negara", "branding daerah", "AI generatif", "rantai pasok"];
  return {
    total: topics.length,
    results: topics.map((t, i) => ({
      id: `https://openalex.org/WUJI${i + 1}`,
      doi: `10.0000/data-uji.${i + 1}`,
      title: `DATA UJI ${i + 1}: Studi ${t} terkait "${String(query).slice(0, 40)}"`,
      year: 2018 + (i % 7),
      authors: ["Penulis Uji Satu", "Penulis Uji Dua", "Penulis Uji Tiga"].slice(0, 1 + (i % 3)),
      venue: i % 2 ? "Jurnal Uji Sistem Informasi" : "Proceedings of the Test Conference",
      venueType: "journal",
      volume: String(10 + i), issue: String(1 + (i % 4)), firstPage: String(100 + i * 10), lastPage: String(109 + i * 10),
      citedBy: 50 - i * 5,
      type: "article",
      abstract: i === 5 ? "" : `Abstrak data uji tentang ${t}. Studi ini membahas ${t} dengan pendekatan kuantitatif pada konteks ${i % 2 ? "Indonesia" : "Asia Tenggara"}.`,
    })),
  };
}

export function mockLlm(task, body) {
  if (task === "keywords") {
    return {
      queries: ["batik packaging consumer perception", "batik motif export market", "traditional textile design Indonesia"],
      concepts: ["batik", "packaging", "consumer perception"],
      perProdi: (Array.isArray(body.prodi) ? body.prodi : String(body.prodi || "").split(/\s*,\s*/)).filter(Boolean).map((p) => ({ prodi: p, query: `batik ${p.toLowerCase()} lens` })),
    };
  }
  if (task === "gap") {
    const ns = (body.papers || []).map((w) => w.n);
    const v = ["Ya", "Sebagian", "Belum"];
    return {
      aspects: ["Visual (DKV)", "Ekspor", "Analitik", "Konteks Indonesia"],
      rows: ns.map((n, i) => ({ n, cells: [v[i % 3], v[(i + 1) % 3], v[(i + 2) % 3], i % 2 ? "Ya" : "Belum"], note: `Catatan uji untuk makalah ${n}` })),
      gaps: [
        { statement: "Belum ada studi yang menggabungkan persepsi visual dengan data ekspor dalam konteks Indonesia.", evidence: ns.slice(0, 2) },
        { statement: "Analitik komentar konsumen mancanegara terhadap motif lokal belum diteliti.", evidence: ns.slice(2, 4) },
      ],
    };
  }
  if (task === "contrib") {
    const roles = ["conceptualization", "methodology", "software", "formal analysis", "data curation", "visualization", "writing—original draft", "writing—review and editing", "resources", "supervision", "validation", "investigation"];
    return { authors: (body.authors || []).map((a, i) => ({ i: i + 1, roles: [roles[(i * 2) % roles.length], roles[(i * 2 + 1) % roles.length]], tasks: [`tugas uji ${i + 1}`] })) };
  }
  if (task === "titles") {
    return {
      titles: [
        { title: `${body.title} di Pasar Ekspor Asia Tenggara`, reason: "Mempersempit konteks ke pasar tujuan yang belum banyak diteliti." },
        { title: `${body.title}: Eksperimen Persepsi Visual Lintas Negara`, reason: "Menonjolkan metode eksperimen sebagai pembeda." },
        { title: `Peran Desain Kemasan dalam ${body.title}`, reason: "Menegaskan variabel desain sebagai fokus gap." },
      ],
      keywords: ["batik", "packaging design", "export", "consumer perception", "SMEs"],
    };
  }
  if (task === "draft") {
    const ns = (body.papers || []).map((w) => w.n);
    const c = (i) => `[${ns[i % ns.length] || 1}]`;
    const isId = body.lang === "id";
    const ph = (en, id) => `[${isId ? id : en}]`;
    return {
      abstract: `This draft examines ${body.title || "the topic"}. Prior studies addressed visual perception and export separately. This study will survey ${ph("number of respondents", "jumlah responden")} consumers and analyze ${ph("export data source", "sumber data ekspor")}. Expected results: ${ph("main finding", "temuan utama")}.`,
      keywords: ["batik", "export", "perception", "SMEs"],
      sections: [
        { heading: "Introduction", paragraphs: [`Indonesian SMEs increasingly sell abroad ${c(0)}. Visual identity matters ${c(1)}, [99].`, `This paper addresses the gap ${c(2)}, ${c(3)}.`] },
        { heading: "Related Work", paragraphs: [`Studies on packaging ${c(4)} and on export ${c(5)}–${c(6)} rarely meet.`, `Table I summarizes the reviewed studies ${c(7)}.`] },
        { heading: "Research Method", paragraphs: [`A between-subject experiment with ${ph("number of respondents", "jumlah responden")} participants will be run in ${ph("location", "lokasi")}.`] },
        { heading: "Expected Results", paragraphs: [`We expect ${ph("expected difference in perceived premium", "perbedaan persepsi premium")} between variants.`] },
        { heading: "Conclusion", paragraphs: [`The study will contribute a framework linking design and trade ${c(0)}.`] },
      ],
    };
  }
  return {};
}
