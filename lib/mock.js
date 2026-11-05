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
      noveltyQuery: "batik packaging purchase intention",
      perProdi: (Array.isArray(body.prodi) ? body.prodi : String(body.prodi || "").split(/\s*,\s*/)).filter(Boolean).map((p) => ({ prodi: p, query: `batik ${p.toLowerCase()} lens` })),
    };
  }
  if (task === "gap") {
    const ns = (body.papers || []).map((w) => w.n);
    const v = ["Yes", "Partial", "No"];
    return {
      aspects: ["Visual Perception (VCD)", "Export (Trade)", "Analytics (CS)", "Indonesian Context"],
      rows: ns.map((n, i) => ({ n, cells: [v[i % 3], v[(i + 1) % 3], v[(i + 2) % 3], i % 2 ? "Yes" : "No"], note: `Test note for paper ${n}.` })),
      gaps: [
        { statement: `Although Satu et al. (2018) [${ns[0]}] examined visual perception and Satu and Dua (2019) [${ns[1]}] analysed export data, no study has combined both in the Indonesian context.`, evidence: ns.slice(0, 2) },
        { statement: `Foreign consumers' comments on local motifs have not been analysed computationally, as Satu (2020) [${ns[2]}] focused only on design.`, evidence: ns.slice(2, 3) },
      ],
    };
  }
  if (task === "contrib") {
    const roles = ["conceptualization", "methodology", "software", "formal analysis", "data curation", "visualization", "writing—original draft", "writing—review and editing", "resources", "supervision", "validation", "investigation"];
    return { authors: (body.authors || []).map((a, i) => ({ i: i + 1, roles: [roles[(i * 2) % roles.length], roles[(i * 2 + 1) % roles.length]], tasks: [`tugas uji ${i + 1}`] })) };
  }
  if (task === "method") {
    const id = body.lang === "id";
    const ap = ["quant", "qual", "mixed", "dsr"].includes(body.approach) ? body.approach : "";
    return { options: [
      { approach: ap || "quant", label: id ? "Eksperimen persepsi visual" : "Visual perception experiment", design: id ? "Eksperimen antarsubjek dengan dua varian kemasan." : "Between-subject experiment with two packaging variants.", data: id ? "[jumlah responden] konsumen mancanegara melalui panel daring." : "[number of respondents] foreign consumers via an online panel.", analysis: id ? "ANOVA dan SEM-PLS." : "ANOVA and SEM-PLS.", evaluation: id ? "Uji validitas dan reliabilitas (AVE, CR)." : "Validity and reliability tests (AVE, CR).", why: "Satu et al. (2018) [1] did not test foreign consumers." },
      { approach: ap || "dsr", label: id ? "Analisis sentimen ulasan" : "Review sentiment analysis", design: id ? "Studi komputasional atas ulasan daring." : "Computational study of online reviews.", data: id ? "[jumlah ulasan] ulasan marketplace lintas negara." : "[number of reviews] cross-border marketplace reviews.", analysis: id ? "IndoBERT dan analisis topik." : "IndoBERT and topic modelling.", evaluation: "F1-score, 5-fold cross-validation.", why: "Satu (2020) [3] focused only on design." },
      { approach: ap || "mixed", label: id ? "Metode campuran" : "Mixed methods", design: id ? "Wawancara UMKM lalu survei." : "SME interviews followed by a survey.", data: id ? "[jumlah informan] informan dan [jumlah responden] responden." : "[number of informants] informants and [number of respondents] respondents.", analysis: id ? "Analisis tematik dan regresi." : "Thematic analysis and regression.", evaluation: id ? "Triangulasi dan uji asumsi klasik." : "Triangulation and classical assumption tests.", why: "Combines design and trade views." },
    ] };
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
        { heading: isId ? "Hasil dan Pembahasan" : "Results and Discussion", paragraphs: [`${ph("Table II: hypothesis test results", "Tabel II: hasil uji hipotesis")} summarizes the tests.`, `${ph("main finding", "temuan utama")} is consistent with ${c(1)} but differs from ${c(2)}.`] },
        { heading: "Conclusion", paragraphs: [`The study will contribute a framework linking design and trade ${c(0)}.`] },
      ],
    };
  }
  return {};
}
