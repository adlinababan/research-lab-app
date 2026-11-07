import { standardItems } from "../public/standards.js";
// Data uji untuk MOCK=1 (hanya untuk pengujian lokal, bukan untuk pelatihan).
// Semua judul diberi label "DATA UJI" dan DOI 10.0000/... agar tidak tertukar dengan literatur nyata.

const qh = (q) => [...String(q)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7);
export function mockSearch(query) {
  const topics = ["persepsi konsumen", "ekspor UMKM", "desain kemasan", "analisis sentimen", "e-commerce lintas negara", "branding daerah", "AI generatif", "rantai pasok"];
  return {
    total: topics.length,
    results: topics.map((t, i) => ({
      id: `https://openalex.org/WUJI${qh(query)}${i + 1}`,
      doi: `10.0000/data-uji.${qh(query)}.${i + 1}`,
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
  if (task === "results") {
    // Angka diambil dari tabel pertama yang diunggah agar kunci angka bisa diuji.
    const t = (body.tables || [])[0];
    const nums = t ? (t.rows || []).flat().filter((c) => /^\d+(\.\d+)?$/.test(String(c))) : [];
    const f = (body.figures || []).map((x, i) => ({ id: x.id, use: i < 3, placement: /flow|alur|arsitektur/i.test(x.name) ? "method" : "results", caption: `Caption uji untuk ${x.name}`, why: "Alasan uji." }));
    const tb = (body.tables || []).map((x) => ({ id: x.id, use: true, placement: "results", caption: `Caption Uji ${x.name}`, why: "Alasan uji." }));
    const tid = tb[0]?.id, fid = f.find((x) => x.use && x.placement === "results")?.id;
    const x1 = (body.texts || [])[0];
    return {
      figures: f, tables: tb,
      newTables: x1 ? [{ source: x1.id, caption: "Tabel dari output teks (uji)", placement: "results", headers: ["Kelas", "F1"], rows: [["positif", "0.91"], ["negatif", "0.42"]] }] : [],
      results: [
        { role: "results", text: `${tid ? `{{table:${tid}}} ` : ""}menunjukkan model usulan mencapai ${nums[0] || "[nilai]"} dibanding baseline ${nums[1] || "[nilai]"}. (DATA UJI)` },
        { role: "comparison", text: `Hasil ini sejalan dengan Satu et al. [1]${fid ? `, dan {{figure:${fid}}} memperlihatkan pola kesalahan` : ""}. Nilai 77.7 sengaja tidak ada di file.` },
        { role: "interpretation", text: (() => {
          const tr = (body.texts || []).find((t) => t.kind === "transcript");
          const real = tr ? String(tr.text).split(/[.\n]/).map((x) => x.trim()).find((x) => x.split(/\s+/).length >= 6) : "";
          return real ? `Informan menyatakan "${real}" (I1), sedangkan "kalimat karangan yang tidak pernah diucapkan informan mana pun" (I2). (DATA UJI)` : "Perbedaan kinerja menunjukkan manfaat praktis pada data uji.";
        })() },
        { role: "limitation", text: "Satu kali run membatasi kesimpulan." },
      ],
      conclusion: [{ role: "answer", text: `Model usulan mencapai ${nums[0] || "[nilai]"} pada data uji. (DATA UJI)` }],
      abstract: ["background", "gap", "objective", "method", "results", "contribution"].map((r) => ({ role: r, text: `Segmen ${r} abstrak uji${r === "results" && nums[0] ? ` dengan nilai ${nums[0]}` : ""}.` })),
      missing: ["Belum ada uji statistik antar model.", "Hanya satu kali run tanpa simpangan baku."],
    };
  }
  if (task === "review") {
    const standard = body.profile ? standardItems(body.profile).map((it, n) => ({ id: it.id, status: ["met", "partial", "missing"][n % 3], note: `Catatan uji untuk ${it.id}.` })) : undefined;
    return {
      standard,
      verdict: "major revision",
      summary: "Struktur sudah mengikuti template IEEE, tetapi metode dan pembahasan belum cukup rinci. (DATA UJI)",
      strengths: ["Judul spesifik dan tanpa subjudul."],
      checks: [
        { id: "objective_answered", status: "warn", note: "Tujuan dijawab, tetapi hasil masih placeholder. (DATA UJI)" },
        { id: "method_traceable", status: "ok", note: "Desain dan data dijelaskan." },
        { id: "numbers_consistent", status: "ok", note: "Placeholder konsisten." },
        { id: "contributions_supported", status: "warn", note: "Kontribusi (3) belum terlihat di hasil." },
        { id: "references_support", status: "ok", note: "Sitasi sesuai klaim." },
        { id: "no_template_text", status: "ok", note: "Tidak ada teks template." },
      ],
      findings: [
        { section: "Conclusion", severity: "minor", quote: "The study will contribute", issue: "Kesimpulan masih berbentuk rencana.", suggestion: "Tulis jawaban atas tujuan dengan placeholder temuan utama." },
        { section: "Method", severity: "major", quote: "A between-subject experiment", issue: "Jumlah dan kriteria partisipan belum dijelaskan.", suggestion: "Tambahkan teknik sampling, [jumlah responden], dan persetujuan etik." },
        { section: "Related Work", severity: "major", quote: "Studies on packaging", issue: "Masih meringkas per makalah.", suggestion: "Susun per tema dan rujuk Tabel I." },
      ],
    };
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
    const P = (role, text) => ({ role, text });
    return {
      abstract: [
        P("background", `Small and medium enterprises increasingly sell abroad, yet ${body.title || "the topic"} remains poorly understood.`),
        P("gap", "Prior studies examined visual perception and export performance separately."),
        P("objective", "This study examines how packaging design relates to foreign purchase intention."),
        P("method", `A between-subject experiment with ${ph("number of respondents", "jumlah responden")} participants compared two packaging variants using structural equation modelling.`),
        P("results", `The results show ${ph("main finding", "temuan utama")} with ${ph("effect size", "ukuran efek")}.`),
        P("contribution", "The findings inform design decisions for export-oriented enterprises."),
      ],
      keywords: ["consumer perception", "export", "packaging design", "SMEs"],
      sections: [
        { heading: "Introduction", paragraphs: [P("context", `Indonesian SMEs increasingly sell abroad ${c(0)}.`), P("problem", `Visual identity affects purchase decisions ${c(1)}.`), P("gap", `Among the reviewed studies, few combine design and trade ${c(2)}, ${c(3)}.`), P("objective", "This study asks how packaging design relates to purchase intention."), P("contribution", "The contributions are (1) a framework, (2) an experiment, and (3) design guidance."), P("organization", "The remainder of this paper is organized as follows.")] },
        { heading: "Related Work", paragraphs: [P("theme", `Studies on packaging ${c(4)} and on export ${c(5)}–${c(6)} rarely meet.`), P("comparison", `They differ in evaluation design ${c(7)}.`), P("positioning", "Table I summarizes the reviewed studies and the remaining gap.")] },
        { heading: "Research Method", paragraphs: [P("design", "A between-subject experiment was conducted, as shown in [Fig. 1: research workflow]."), P("data", `Participants (${ph("number of respondents", "jumlah responden")}) were recruited in ${ph("location", "lokasi")}.`), P("evaluation", "Validity and reliability were tested before hypothesis testing.")] },
        { heading: isId ? "Hasil dan Pembahasan" : "Results and Discussion", paragraphs: [P("results", `${ph("Table II: hypothesis test results", "Tabel II: hasil uji hipotesis")} summarizes the tests.`), P("comparison", `${ph("main finding", "temuan utama")} is consistent with ${c(1)} but differs from ${c(2)}.`), P("limitation", "A single location limits generalisation.")] },
        { heading: "Conclusion", paragraphs: [P("answer", `The study found ${ph("main finding", "temuan utama")}, contributing a framework that links design and trade.`)] },
      ],
    };
  }
  return {};
}
