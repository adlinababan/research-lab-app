// Standar minimum pelaporan per jenis penelitian untuk paper IEEE.
// BUKAN aturan resmi IEEE: IEEE hanya meminta metode yang dapat direproduksi, hasil dengan tabel/gambar,
// dan pembahasan kontribusi. Butir di sini dirangkum dari standar pelaporan yang dipakai reviewer:
// ACM SIGSOFT Empirical Standards, REFORMS, COREQ/SRQR, APA JARS, Hair et al. (2019), Peffers et al. (2007).
// Dipakai di browser (kartu standar, daftar isi ZIP) dan server (prompt draf, hasil, reviewer).
//
// part: M = Metode, D = Data, H = Hasil, P = Pembahasan.  level: "wajib" | "dianjurkan".
// zip: pola untuk mendeteksi bukti di ZIP hasil (where: tab = tabel, fig = gambar, all = semua; atau
// "@transcripts", "@project", "@figures").

export const PARTS = { M: "Metode", D: "Data", H: "Hasil", P: "Pembahasan" };

const COMMON = [
  { id: "C1", part: "M", level: "wajib", text: "Pertanyaan penelitian atau hipotesis dinyatakan jelas, lalu dijawab satu per satu di Hasil.", en: "Research questions or hypotheses are stated explicitly and each one is answered in the Results." },
  { id: "C2", part: "M", level: "wajib", text: "Metode cukup rinci untuk direproduksi: langkah, alat beserta versi, dan parameter.", en: "The method is detailed enough to be reproduced: steps, tools with versions, and parameters." },
  { id: "C3", part: "D", level: "wajib", text: "Pernyataan ketersediaan data dan kode (Open Data).", en: "A data and code availability statement." },
  { id: "C4", part: "M", level: "wajib", text: "Etika bila melibatkan manusia: izin, persetujuan partisipan, anonimisasi.", en: "Ethics when human participants are involved: approval, informed consent, anonymisation." },
  { id: "C5", part: "P", level: "wajib", text: "Ancaman validitas atau keterbatasan, beserta dampaknya.", en: "Threats to validity or limitations and their effect on the conclusions." },
  { id: "C6", part: "P", level: "wajib", text: "Perbandingan dengan penelitian sebelumnya yang dirujuk.", en: "Comparison of the findings with the cited prior studies." },
  { id: "C7", part: "P", level: "wajib", text: "Klaim tidak melebihi bukti (tanpa klaim mutlak atau kausal yang tidak didukung desain).", en: "Claims do not exceed the evidence (no absolute claims, no causal claims the design cannot support)." },
];

const SEM = [
  { id: "S1", part: "M", level: "wajib", text: "Populasi, teknik sampling, dan ukuran sampel beserta dasar penentuannya.", en: "Population, sampling technique, and sample size with its justification (e.g. power analysis or minimum sample rule)." },
  { id: "S2", part: "M", level: "wajib", text: "Instrumen: konstruk, jumlah butir, sumber skala, dan skala jawaban.", en: "Instrument: constructs, number of items, source of each scale, and response scale." },
  { id: "S3", part: "M", level: "wajib", text: "Alasan memakai PLS-SEM atau CB-SEM, alat (mis. SmartPLS 4), dan jumlah subsample bootstrapping.", en: "Why PLS-SEM or CB-SEM was chosen, the software (e.g. SmartPLS 4), and the number of bootstrap subsamples." },
  { id: "S4", part: "M", level: "dianjurkan", text: "Pre-test instrumen dan pemeriksaan common method bias.", en: "Instrument pre-test and a common method bias check." },
  { id: "S5", part: "H", level: "wajib", text: "Profil responden.", en: "Respondent profile.", zip: ["all", "profil|demograf|jenis kelamin|gender|usia|\\bage\\b|responden"] },
  { id: "S6", part: "H", level: "wajib", text: "Outer loadings setiap indikator.", en: "Outer loadings of every indicator.", zip: ["tab", "loading"] },
  { id: "S7", part: "H", level: "wajib", text: "Reliabilitas: Cronbach's alpha dan composite reliability (rho_a/rho_c).", en: "Internal consistency reliability: Cronbach's alpha and composite reliability (rho_a/rho_c).", zip: ["tab", "cronbach|composite|rho_?[ac]"] },
  { id: "S8", part: "H", level: "wajib", text: "Validitas konvergen (AVE).", en: "Convergent validity (AVE).", zip: ["tab", "average variance|\\bave\\b"] },
  { id: "S9", part: "H", level: "wajib", text: "Validitas diskriminan (HTMT, atau Fornell-Larcker).", en: "Discriminant validity (HTMT, or Fornell-Larcker).", zip: ["tab", "htmt|heterotrait|fornell"] },
  { id: "S10", part: "H", level: "wajib", text: "Kolinearitas model struktural (VIF).", en: "Structural model collinearity (inner VIF).", zip: ["tab", "\\bvif\\b|collinearity"] },
  { id: "S11", part: "H", level: "wajib", text: "Koefisien jalur dengan t statistik dan p value hasil bootstrapping.", en: "Path coefficients with t statistics and p values from bootstrapping.", zip: ["tab", "p.?values?|t.?stat|path coef|bootstrap"] },
  { id: "S12", part: "H", level: "wajib", text: "R² setiap konstruk endogen.", en: "R² of every endogenous construct.", zip: ["tab", "r.?square|r²|\\br2\\b"] },
  { id: "S13", part: "H", level: "dianjurkan", text: "f² dan Q² atau PLSpredict.", en: "f² effect sizes and Q² or PLSpredict.", zip: ["tab", "f.?square|f²|q²|\\bq2\\b|plspredict"] },
  { id: "S14", part: "H", level: "wajib", text: "Tabel keputusan setiap hipotesis (didukung atau tidak).", en: "A table with the decision for every hypothesis (supported or not)." },
  { id: "S15", part: "P", level: "wajib", text: "Makna setiap hipotesis yang didukung atau ditolak, serta implikasi teoretis dan praktis.", en: "Meaning of each supported or rejected hypothesis, with theoretical and practical implications." },
];

const STATS = [
  { id: "Q1", part: "M", level: "wajib", text: "Populasi, teknik sampling, dan ukuran sampel beserta dasar penentuannya.", en: "Population, sampling technique, and sample size with its justification." },
  { id: "Q2", part: "M", level: "wajib", text: "Instrumen dan sumber skala; untuk eksperimen: desain, kelompok kontrol, dan randomisasi.", en: "Instrument and scale sources; for experiments: design, control group, and randomisation." },
  { id: "Q3", part: "M", level: "wajib", text: "Teknik analisis, alat (mis. SPSS versi), dan tingkat signifikansi.", en: "Analysis techniques, software with version, and significance level." },
  { id: "Q4", part: "H", level: "wajib", text: "Profil responden atau sampel.", en: "Respondent or sample profile.", zip: ["all", "profil|demograf|jenis kelamin|gender|usia|\\bage\\b|responden|frequenc"] },
  { id: "Q5", part: "H", level: "wajib", text: "Uji validitas instrumen.", en: "Instrument validity test.", zip: ["tab", "validit|r.?hitung|corrected item|item-total|pearson|correlations"] },
  { id: "Q6", part: "H", level: "wajib", text: "Uji reliabilitas (Cronbach's alpha).", en: "Reliability test (Cronbach's alpha).", zip: ["tab", "cronbach|reliab"] },
  { id: "Q7", part: "H", level: "wajib", text: "Uji asumsi yang sesuai analisis (normalitas, multikolinearitas, dll.).", en: "Assumption tests appropriate to the analysis (normality, multicollinearity, etc.).", zip: ["tab", "normal|kolmogorov|shapiro|\\bvif\\b|tolerance|glejser|heterosk|levene"] },
  { id: "Q8", part: "H", level: "wajib", text: "Uji hipotesis: koefisien, t atau F, derajat bebas, dan p.", en: "Hypothesis tests: coefficients, t or F, degrees of freedom, and p.", zip: ["tab", "coefficient|koefisien|anova|t.?test|\\bsig\\b|regres"] },
  { id: "Q9", part: "H", level: "wajib", text: "Ukuran efek (R², Cohen's d, atau η²).", en: "Effect sizes (R², Cohen's d, or η²).", zip: ["tab", "r square|r²|cohen|eta|effect size|model summary"] },
  { id: "Q10", part: "H", level: "wajib", text: "Keputusan setiap hipotesis.", en: "The decision for every hypothesis." },
  { id: "Q11", part: "P", level: "wajib", text: "Interpretasi tanpa klaim sebab-akibat pada desain korelasional, serta implikasinya.", en: "Interpretation without causal claims for correlational designs, and implications." },
];

const QUAL = [
  { id: "K1", part: "M", level: "wajib", text: "Pendekatan kualitatif (studi kasus, fenomenologi, dll.) dan alasannya.", en: "Qualitative approach (case study, phenomenology, etc.) and its rationale." },
  { id: "K2", part: "M", level: "wajib", text: "Pemilihan informan dan kriterianya, jumlah informan, dan alasan cukup (saturasi).", en: "Informant selection and criteria, number of informants, and why it was sufficient (saturation)." },
  { id: "K3", part: "M", level: "wajib", text: "Pengumpulan data: panduan wawancara/FGD, durasi, perekaman, dan transkripsi.", en: "Data collection: interview or FGD guide, duration, recording, and transcription." },
  { id: "K4", part: "M", level: "wajib", text: "Proses analisis: koding atau analisis tematik, alat (mis. NVivo), dan siapa yang mengoding.", en: "Analysis process: coding or thematic analysis, software (e.g. NVivo), and who coded." },
  { id: "K5", part: "M", level: "wajib", text: "Keabsahan data: triangulasi, member checking, atau audit trail.", en: "Trustworthiness: triangulation, member checking, or audit trail." },
  { id: "K6", part: "M", level: "dianjurkan", text: "Refleksivitas: posisi dan hubungan peneliti dengan partisipan.", en: "Reflexivity: the researchers' position and relationship to participants." },
  { id: "K7", part: "H", level: "wajib", text: "Profil informan dengan kode (tanpa nama asli).", en: "Informant profile using codes only (no real names).", zip: ["all", "informan|partisipan|participant|narasumber|profil"] },
  { id: "K8", part: "H", level: "wajib", text: "Tema dan subtema (tabel atau peta tema).", en: "Themes and sub-themes (table or thematic map).", zip: ["tab", "code|kode|tema|theme|node|kategori"] },
  { id: "K9", part: "H", level: "wajib", text: "Kutipan verbatim yang mendukung setiap tema, dengan kode informan.", en: "Verbatim quotations supporting each theme, with informant codes.", zip: ["@transcripts"] },
  { id: "K10", part: "H", level: "dianjurkan", text: "Hubungan antartema atau model temuan.", en: "Relationships between themes or an emerging model.", zip: ["@figures"] },
  { id: "K11", part: "P", level: "wajib", text: "Kaitan tema dengan teori dan studi terdahulu, serta keteralihan (transferability).", en: "Links between themes, theory, and prior studies, and transferability." },
];

const ML = [
  { id: "L1", part: "D", level: "wajib", text: "Sumber dataset, lisensi, ukuran, dan distribusi kelas.", en: "Dataset source, licence, size, and class distribution." },
  { id: "L2", part: "M", level: "wajib", text: "Pra-pemrosesan dan langkah mencegah kebocoran data (data leakage).", en: "Pre-processing and the steps taken to prevent data leakage." },
  { id: "L3", part: "M", level: "wajib", text: "Pembagian data (train/validasi/uji atau k-fold) dan seed.", en: "Data split (train/validation/test or k-fold) and random seeds.", zip: ["all", "seed|split|fold|train|test"] },
  { id: "L4", part: "M", level: "wajib", text: "Model atau arsitektur, hiperparameter, dan cara tuning.", en: "Model or architecture, hyperparameters, and how they were tuned.", zip: ["all", "epoch|learning.?rate|\\blr\\b|batch|hyperparam|config"] },
  { id: "L5", part: "M", level: "wajib", text: "Perangkat keras dan perangkat lunak beserta versinya.", en: "Hardware and software with versions.", zip: ["all", "gpu|cuda|torch|tensorflow|python|sklearn|scikit"] },
  { id: "L6", part: "H", level: "wajib", text: "Perbandingan dengan minimal dua baseline pada data yang sama.", en: "Comparison with at least two baselines on the same data.", zip: ["tab", "baseline|svm|random forest|logistic|bert|cnn|lstm|model"] },
  { id: "L7", part: "H", level: "wajib", text: "Metrik yang sesuai tugas, termasuk per kelas bila data tidak seimbang.", en: "Task-appropriate metrics, including per-class metrics when classes are imbalanced.", zip: ["tab", "accuracy|akurasi|\\bf1|precision|recall|rmse|\\bmae\\b|\\bauc\\b|support"] },
  { id: "L8", part: "H", level: "wajib", text: "Variasi antar-run (mean ± std) atau uji signifikansi.", en: "Variation across runs (mean ± std) or a significance test.", zip: ["all", "\\bstd\\b|±|\\bruns?\\b|p.?value|wilcoxon|t.?test"] },
  { id: "L9", part: "H", level: "dianjurkan", text: "Ablation atau analisis kesalahan (mis. confusion matrix).", en: "Ablation or error analysis (e.g. confusion matrix).", zip: ["all", "ablas|ablation|confusion|error analysis"] },
  { id: "L10", part: "H", level: "dianjurkan", text: "Biaya komputasi: waktu latih atau inferensi, ukuran model.", en: "Computational cost: training or inference time, model size.", zip: ["all", "inferen|latency|waktu|time|params|ukuran model"] },
  { id: "L11", part: "P", level: "wajib", text: "Alasan model unggul atau kalah, dan batas generalisasi.", en: "Why the model wins or loses, and the limits of generalisation." },
];

const DSR = [
  { id: "R1", part: "M", level: "wajib", text: "Masalah dan tujuan solusi yang terukur (mis. waktu pencatatan turun, bukan sekadar \"memudahkan\").", en: "The problem and measurable solution objectives (e.g. recording time reduced, not merely \"makes it easier\")." },
  { id: "R2", part: "M", level: "wajib", text: "Model proses (DSRM Peffers et al. atau SDLC) dan alasan memilih metode pengembangan (Waterfall, Prototyping, Scrum, RAD).", en: "Process model (Peffers et al. DSRM or an SDLC) and why the development method (Waterfall, Prototyping, Scrum, RAD) was chosen." },
  { id: "R3", part: "M", level: "wajib", text: "Cara mengumpulkan kebutuhan, serta kebutuhan fungsional dan non-fungsional (keamanan, kinerja, ketersediaan).", en: "How requirements were gathered, and the functional and non-functional requirements (security, performance, availability)." },
  { id: "R4", part: "M", level: "wajib", text: "Rancangan evaluasi: tingkat pengujian (unit, integrasi, sistem/black-box, UAT), responden, dan kriteria keberhasilan.", en: "Evaluation design: test levels (unit, integration, system/black-box, acceptance), participants, and success criteria." },
  { id: "R5", part: "M", level: "dianjurkan", text: "Atribut kualitas yang diuji dipetakan ke ISO/IEC 25010.", en: "Quality attributes evaluated, mapped to ISO/IEC 25010." },
  { id: "R6", part: "H", level: "wajib", text: "Penelusuran kebutuhan ke fitur dan ke pengujian (traceability).", en: "Traceability from requirements to features and to tests." },
  { id: "R7", part: "H", level: "wajib", text: "Rancangan: arsitektur, use case, dan ERD.", en: "Design: architecture, use case, and ERD.", zip: ["fig", "use.?case|erd|arsitektur|architecture|class|activity|sequence|flow|diagram|uml"] },
  { id: "R8", part: "H", level: "wajib", text: "Implementasi: teknologi dan modul utama (screenshot hanya ilustrasi).", en: "Implementation: technology stack and main modules (screenshots only illustrate).", zip: ["@project"] },
  { id: "R9", part: "H", level: "wajib", text: "Pengujian fungsional (black-box atau unit test) dengan jumlah lulus dan gagal.", en: "Functional testing (black-box or unit tests) with passed and failed counts.", zip: ["all", "black.?box|test.?case|skenario|pengujian|junit|unit.?test"] },
  { id: "R10", part: "H", level: "wajib", text: "Evaluasi pengguna (SUS atau UAT): jumlah responden, skor rata-rata, dan interpretasinya. Wajib bila paper mengklaim aplikasi mudah digunakan.", en: "User evaluation (SUS or UAT): number of participants, mean score, and its interpretation; required whenever the paper claims ease of use.", zip: ["all", "\\bsus\\b|usability|kegunaan|kuesioner|questionnaire|\\buat\\b|acceptance"] },
  { id: "R11", part: "H", level: "wajib", text: "Perbandingan sebelum–sesudah, atau dengan sistem lama/alternatif, memakai ukuran yang sama.", en: "A before–after comparison, or a comparison with the existing or an alternative system, using the same measures.", zip: ["all", "sebelum|sesudah|before|after|manual|existing|sistem lama|perbandingan|comparison|baseline"] },
  { id: "R12", part: "H", level: "dianjurkan", text: "Kinerja: waktu respons atau uji beban.", en: "Performance: response time or load testing.", zip: ["all", "response time|waktu respons|load|latency|throughput|jmeter|lighthouse"] },
  { id: "R13", part: "H", level: "dianjurkan", text: "Keamanan dasar (mis. pemeriksaan berdasarkan OWASP Top 10) bila menyimpan data pribadi.", en: "Basic security checks (e.g. against the OWASP Top 10) when personal data is stored.", zip: ["all", "owasp|security|keamanan|penetration|vulnerab|\\bzap\\b|burp"] },
  { id: "R14", part: "D", level: "dianjurkan", text: "Ketersediaan artefak: repositori kode, demo, atau video.", en: "Artefact availability: code repository, demo, or video." },
  { id: "R15", part: "P", level: "wajib", text: "Sejauh mana artefak menyelesaikan masalah, dibandingkan sistem atau penelitian lain.", en: "How far the artefact solves the problem, compared with other systems or studies." },
  { id: "R16", part: "P", level: "wajib", text: "Jenis kontribusi dinyatakan jelas: artefak baru, perbaikan desain, atau penerapan solusi lama di konteks baru, bukan sekadar \"membangun aplikasi X di Y\".", en: "The type of contribution is explicit: a new artefact, an improved design, or a known solution applied to a new context, not merely \"building app X at Y\"." },
];

const MIXED = [
  { id: "X1", part: "M", level: "wajib", text: "Desain campuran (konvergen, eksplanatori, atau eksploratori) dan urutan pengumpulan data.", en: "Mixed-methods design (convergent, explanatory, or exploratory) and sequence of data collection." },
  ...STATS.filter((x) => ["Q1", "Q2", "Q4", "Q6", "Q8", "Q9"].includes(x.id)),
  ...QUAL.filter((x) => ["K2", "K4", "K5", "K8", "K9"].includes(x.id)),
  { id: "X2", part: "H", level: "wajib", text: "Integrasi kedua bagian (mis. tabel joint display): menjelaskan, menguatkan, atau bertentangan.", en: "Integration of both strands (e.g. a joint display): where findings explain, confirm, or contradict each other." },
];

export const STANDARDS = {
  ml: { name: "Komputasional / machine learning", sources: "REFORMS (Kapoor et al., 2024); ACM SIGSOFT Empirical Standards: Data Science", items: ML },
  sem: { name: "SEM-PLS / CB-SEM (SmartPLS, AMOS)", sources: "Hair et al. (2019), When to use and how to report the results of PLS-SEM; ACM SIGSOFT Empirical Standards: Questionnaire Surveys", items: SEM },
  stats: { name: "Statistik survei/eksperimen (SPSS, JASP)", sources: "APA JARS-Quant (Appelbaum et al., 2018); ACM SIGSOFT Empirical Standards: Questionnaire Surveys, Experiments", items: STATS },
  qual: { name: "Kualitatif (wawancara, FGD)", sources: "COREQ (Tong et al., 2007); SRQR (O'Brien et al., 2014); ACM SIGSOFT Empirical Standards: Qualitative Surveys", items: QUAL },
  mixed: { name: "Metode campuran", sources: "APA JARS-Mixed (Levitt et al., 2018); standar kuantitatif dan kualitatif di atas", items: MIXED },
  dsr: { name: "Pengembangan aplikasi / design science", sources: "Peffers et al. (2007), DSRM; Hevner et al. (2004); ISO/IEC 25010 (model kualitas perangkat lunak); Brooke (1996), SUS; OWASP Top 10; ACM SIGSOFT Empirical Standards: Engineering Research", items: DSR },
};
export const COMMON_ITEMS = COMMON;
export const COMMON_SOURCES = "ACM SIGSOFT Empirical Standards: General Standard; IEEE Author Center, Structure Your Article";
export const standardKey = (k) => (STANDARDS[k] ? k : "ml");
export function standardItems(profile) { return [...COMMON, ...STANDARDS[standardKey(profile)].items]; }

// Teks untuk prompt AI (bahasa Inggris).
export function standardPromptText(profile, parts = "MDHP") {
  const S = STANDARDS[standardKey(profile)];
  const items = standardItems(profile).filter((x) => parts.includes(x.part));
  const by = (p) => items.filter((x) => x.part === p).map((x) => `  - [${x.id}${x.level === "wajib" ? ", REQUIRED" : ", recommended"}] ${x.en}`).join("\n");
  return `MINIMUM REPORTING STANDARD for ${S.name} (compiled from ${S.sources}; not an official IEEE rule):\n` +
    ["M", "D", "H", "P"].filter((p) => parts.includes(p)).map((p) => `${{ M: "Method", D: "Data", H: "Results", P: "Discussion" }[p]}:\n${by(p)}`).filter((t) => !t.endsWith(":\n")).join("\n");
}
