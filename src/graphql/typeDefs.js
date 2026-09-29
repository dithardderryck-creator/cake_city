const { gql } = require('graphql-tag');

module.exports = gql`
  scalar Date
  scalar DateTime

  enum Jukumu {
    owner
    cashier
    chef
    inventory
  }

  enum HaliOrder {
    "BR-05: described by the cashier, waiting on the owner to quote a price. Not yet confirmed."
    awaiting_quote
    ordered
    in_progress
    ready
    collected
    cancelled
  }

  enum NjiaMalipo {
    cash
    mpesa
    tigopesa
    airtel_money
  }

  enum AinaMarekebisho {
    restock
    waste
  }

  enum AinaUkumbusho {
    anza_kutengeneza
    tarehe_ya_kuchukua
    hisa_itakosa
    hisa_chini
  }

  enum TikitiHali {
    in_queue
    preparing
    ready
    collected
    cancelled
  }

  enum TikitiAina {
    mauzo
    agizo
  }

  type Tikiti {
    id: ID!
    namba: Int!
    tarehe: Date!
    aina: TikitiAina!
    hali: TikitiHali!
    jina: String
    maelezo: String
    jumla: Float
    mauzo_id: ID
    agizo_id: ID
    created_at: DateTime
    updated_at: DateTime
    mauzo: Mauzo
    agizo: AgizoMaalum
  }

  type Ukumbusho {
    id: ID!
    aina: AinaUkumbusho!
    lengo: Jukumu!
    ujumbe: String!
    tarehe_ya_utekelezaji: Date
    muda_inayopendekezwa: DateTime
    imesomwa: Boolean!
    created_at: DateTime
    agizo: AgizoMaalum
    malighafi: Malighafi
  }

  type Mtumiaji {
    id: ID!
    jina: String!
    jukumu: Jukumu!
    active: Boolean
    created_at: DateTime
  }

  type AuthPayload {
    token: String!
    mtumiaji: Mtumiaji!
  }

  type Bidhaa {
    id: ID!
    jina: String!
    bei: Float!
    aina: String
    active: Boolean
    "Flavour family, e.g. 'Keki ya Karoti'. Split out of the free-text name so sizes group together."
    familia: String
    "Size within the family, e.g. 'dira 18' or 'pcs'. Each size is its own sellable thing with its own price and recipe."
    ukubwa: String
    kategoria: Kategoria
  }

  type Kategoria {
    id: ID!
    jina: String!
    active: Boolean
    bidhaa: [Bidhaa!]!
  }

  "A predefined ingredient list for a CUSTOM cake order. Shop products do not use these."
  type Mapishi {
    id: ID!
    ladha: String!
    ukubwa: String!
    dakika_kadirio: Int!
    active: Boolean
    "own_recipe = its own weighed amounts. fraction_of = a portion of another cake (a slice), so it inherits rather than repeating."
    mapamba_variant: String!
    mapishi_ibaba: Mapishi
    "For fraction_of recipes: the portion of the parent cake, as a ratio (0.10 = a tenth). Null for own_recipe."
    sehemu_ya_uzito: Float
    viambato: [MapishiKipengele!]!
    created_at: DateTime
  }

  type MapishiKipengele {
    "Null when this line is derived from a parent recipe rather than stored on this recipe."
    id: ID
    malighafi: Malighafi!
    kiasi_cha_chini: Float!
    kiasi_cha_juu: Float!
    "Which part of the cake: mfuatano (base), krimu (frosting), ... A cake can use the same ingredient twice."
    sehemu: String!
     "True when these amounts were scaled down from a fraction_of parent. Read-only: editing them here would silently change the whole cake."
    inayotokwa: Boolean
     "The tappable amounts for this ingredient, derived from the min and max above. The chef picks one instead of typing a number."
    vipendeleo: [MapishiKiasi!
    ]!
  }

     "One tappable amount. The alama says whether it is the range the recipe actually specifies, so the chef's normal choice is the obvious one."
   type MapishiKiasi {
    kiasi_cha_chini: Float!
    kiasi_cha_juu: Float!
    alama: MapishiKiasiAlama!
  }

   enum MapishiKiasiAlama {
     "Below the recipe's range: the chef used less than suggested."
    chini
     "The range the recipe specifies. This is the tap a chef should make when the bake went to plan."
    hasi
     "Above the recipe's range: the chef used more than suggested."
    juu
  }

  "A request from one staff member to another. Distinct from Ukumbusho, which is computer-generated. aina records which way the intent points: ombi asks for something, direktive instructs."
  enum AinaUkumbushoKazi {
    ombi
    direktive
  }

  "chakati = whenever. kawaida = normal. haraka = today."
  enum KipendeleoUkumbushoKazi {
    chakati
    kawaida
    haraka
  }

  enum HaliOmbi {
    "Written but not sent. Only the sender can see it."
    imeandikwa
    "Sent. Not yet picked up by the recipient."
    imetumwa
    "With the recipient, waiting on a decision."
    inasubiri
    "A directive that has been issued and is waiting to be acknowledged."
    imeanzishwa
    "The recipient has taken it on."
    limekubaliwa
    "Work is under way."
    inaendelea
    "Approved and now being carried out."
    imeidhinishwa
    "Refused. Terminal."
    imekataa
    "The recipient needs more information before deciding. The sender answers and resubmits."
    inahitaji
    "Finished. Terminal."
    imekamilika
    "Withdrawn. Terminal."
    imeghairi
    "Superseded by the upgrade in migration 008. Never produced by the current code."
    fungua
    "Superseded by the upgrade in migration 008. Never produced by the current code."
    imefanyika
  }

  "The timeline of one request or directive: every state it has been through, who did it and when. Read back out of the audit log rather than kept in a second table, so it cannot fall out of step with what actually happened."
  type IsharaOmbi {
    hali: HaliOmbi!
    tarehe: DateTime!
    aliyefanya: Mtumiaji
    ujumbe: String
  }

   type Ombi {
    id: ID!
    kutoka_kwa: Mtumiaji!
    kwenda_kwa: Mtumiaji!
    "The body of the request or directive."
    ujumbe: String!
    "A one-line summary. Separate from ujumbe so a list of twenty is readable."
    mada: String
    "Which direction this goes: asking, or instructing."
    aina: AinaUkumbushoKazi!
    kipendeleo: KipendeleoUkumbushoKazi!
    "The ingredient this concerns, when it concerns one. A procurement request that names sugar in prose and links nothing cannot drive a reorder."
    malighafi: Malighafi
    "How much of it. Requires malighafi."
    kiasi: Float
    "The order this came out of, when it came out of one."
    agizo: AgizoMaalum
    "The usage sheet this request was auto-raised for by BR-13. Non-null only on the confirmation request created when a usage report is submitted. Resolving that request is the confirmation."
    zingumiaji: ZingumiajiMatumizi
    "When this needs to be done by. Null means the owner did not set one."
    mwisho: Date
    "The recipient's role when this was sent, so the record still reads correctly after a role change or a staff deletion."
    jukumu_anayehudumiwa: String
    hali: HaliOmbi!
    "The response or outcome."
    jibu: String
    "Who closed it, and when. A completed record with nobody on it is a record nobody did."
    alizokamilisha_na: Mtumiaji
    alizokamilisha_at: DateTime
    tarehe_ya_kufunguliwa: DateTime
    "True while the record is still waiting on someone."
    hai: Boolean!
    "Overdue: past mwisho and not yet finished."
    imeishia_muda: Boolean!
    "Every state this has been through, oldest first."
    historia: [IsharaOmbi!]!
    created_at: DateTime!
  }

  type Mteja {
    id: ID!
    jina: String!
    simu: String
    "Allergy and dietary information for this person. It belongs to the customer, not the order, because it does not change between orders — and because the chef needs to see it every single time."
    mzio: String
    siku_ya_kuzaliwa: Date
    created_at: DateTime
  }

  "The customer as the kitchen sees them: who it is for, how to reach them, and their allergy info. Deliberately a separate, narrower type from Mteja."
  type MtejaKupika {
    jina: String
    simu: String
    mzio: String
  }

  type AgizoMaalum {
      id: ID!
      mteja: Mteja
      "What the kitchen needs to know about the person, and nothing more. Separate from the mteja field because the full customer record is gated behind order.read_all, which the chef does not have — so reading it through mteja would hand the chef a null and silently hide the allergy info."
      mteja_kupika: MtejaKupika
     ladha: String!
     design: String
     ukubwa: String
     "Owner only. Force a specific recipe when the matcher reads the order wrong. Omit it and the backend matches on ladha + ukubwa; an order nothing matches is recorded as off-book, which is a valid outcome."
    mapishi_id: ID
      "Set when the cake came from the recipe book. NULL means a custom/off-book order, which is the special-order flag."
      mapishi: Mapishi
      "This order's shape, free text. One-off and creative by nature, so it is not a managed list."
      umbo: String
      "This order's special instructions: 'deliver by 3pm', 'extra decoration'. Changes every time, unlike the customer's allergy info on mteja.mzio."
      maelekezo_maalum: String
      tarehe_ya_kuchukua: Date!
      bei_jumla: Float
      malipo_ya_awali: Float
      salio: Float
      hali: HaliOrder!
      muda_hitajika: Int
      created_by: ID
      created_at: DateTime
      updated_at: DateTime
        tikiti: Tikiti
        malipo: Mauzo
        "BR-05: the quote request raised for this order when the till did not price it. Present only while the order is awaiting_quote."
        ombi_bei: Ombi
      }

    # A payment taken against a special order. Recorded in the sales ledger and
    # linked to the order, so the day's takings include money collected at the
    # counter for an order as well as for goods sold over the till.
    type MalipoJumla {
      agizo: AgizoMaalum!
      malipo: Mauzo!
    }

  type MauzoBidhaa {
    id: ID!
    bidhaa: Bidhaa!
    kiasi: Int!
    bei: Float!
  }

  type Mauzo {
    id: ID!
    tarehe: Date!
    mfanyakazi: Mtumiaji
    jumla: Float!
    njia_ya_malipo: NjiaMalipo!
    risiti_no: String!
    created_at: DateTime
    bidhaa: [MauzoBidhaa!]!
    tikiti: Tikiti
    agizo_id: ID
  }

  "A kind of movement in the stock ledger. Usage only counts once confirmed, so an unconfirmed estimate never produces one of these."
  enum AinaMabadiliko {
    "Confirmed usage — stock went down because the kitchen used it."
    matumizi
    "A delivery arrived — stock went up."
    kujaza
    "Spoiled, dropped or expired — stock went down without being used."
    upotevu
  }

  "One line of an ingredient's ledger: everything that explains its current number."
  type MabadilikoHisa {
    id: ID!
    aina: AinaMabadiliko!
    kiasi: Float!
    tarehe: DateTime!
    "Why it happened. Free text for wastage and deliveries, the recipe or order name for usage."
    sababu: String
    "Who recorded it."
    mwingilieji: Mtumiaji
    "The order this usage belongs to, when there is one."
    agizo_id: ID
    "Positive for a delivery, negative for usage or wastage. Ready to be added to a running balance."
    mabadiliko: Float!
  }

  "A recipe that calls for this ingredient, and how much of it per batch."
  type MapishiInayotumika {
    mapishi_id: ID!
    ladha: String!
    ukubwa: String
    kiasi_cha_chini: Float!
    kiasi_cha_juu: Float!
  }

  "One day's real net movement and the balance it left behind. Only days that actually moved are returned — no invented flat days."
  type SikuHisa {
    tarehe: Date!
    "Net change that day. Positive for a delivery, negative for usage and wastage."
    mabadiliko: Float!
    "Balance at the end of that day, derived from the current stock and this day's real movement."
    kiasi: Float!
  }

  "Everything the stock screen needs about one ingredient: the live balance, the ledger that explains it, and what the kitchen spends it on."
  type MaelezoMalighafi {
    malighafi: Malighafi!
    vipengele: [MabadilikoHisa!]!
    mapishi: [MapishiInayotumika!]!
    "Oldest first. Empty when this ingredient has never moved."
    mwenendo: [SikuHisa!]!
  }

     type ZingumiajiMatumizi {
    id: ID!
    agizo: AgizoMaalum
    mpishi: Mtumiaji
    "inakadiriwa = waiting on inventory. imethibitishwa = inventory confirmed the whole production event and stock moved."
    hali: HaliUthibitishoMatumizi!
    "The chef's lines. Empty only while the sheet is being written."
    mistari: [KumbukumbuMatumizi!]!
    kumbukumbu: String
    tarehe: DateTime!
    imethibitishwa_na: Mtumiaji
    tarehe_ya_uthibitisho: DateTime
    created_at: DateTime!
  }

     "What the chef decided about one ingredient. A sheet records a line for every ingredient the recipe listed, including the ones the chef did not use, because 'we left out the cocoa' is production information and its absence is not."
   enum HaliSheeti {
    "The chef tapped one of the recipe's suggested amounts."
    imechaguliwa
    "The chef looked at this ingredient and did not use it. Carries 0 and moves no stock."
    haikutumika
    "An ingredient the recipe did not list, which the chef added because the bake needed it."
    nyingine
  }

     type KumbukumbuMatumizi {
    id: ID!
    agizo: AgizoMaalum
    "The chef's submission this line belongs to. Null on rows written before sheets existed."
    zingumiaji: ZingumiajiMatumizi
    malighafi: Malighafi!
    "The midpoint of the band the chef tapped. Still only an estimate and still moves no stock on its own."
    kiasi: Float!
    "Lower bound of the band the chef tapped. Null when the chef gave an exact number instead of picking a band."
    kiasi_cha_chini: Float
    "Upper bound of the band the chef tapped."
    kiasi_cha_juu: Float
    "What the chef decided about this line. Null on rows written before this existed."
    hali_sheeti: HaliSheeti
    "The recipe line this came from, so an extra ingredient can be told from a suggested one and a half-tuple from a full one."
    mapishi_kipengele_id: ID
    "Which part of the cake this was for, where the recipe uses the same ingredient twice."
    sehemu: String
    mpishi: Mtumiaji
    tarehe: DateTime!
    "inakadiriwa = the chef's estimate, awaiting confirmation. imethibitishwa = inventory confirmed it and stock moved."
    hali: HaliUthibitishoMatumizi!
    "The real number, filled in by inventory at verification. Null until then."
    kiasi_halisi: Float
    imethibitishwa_na: Mtumiaji
    tarehe_ya_uthibitisho: DateTime
    "What this usage was for, when there is no order to say it. e.g. '20 mandazi'."
    kumbukumbu: String
    "Context for the verification queue: which order and which recipe this estimate belongs to. Null for a walk-in batch."
    agizo_ladha: String
    agizo_ukubwa: String
    mapishi_ladha: String
    mapishi_ukubwa: String
  }

  enum HaliUthibitishoMatumizi {
    "Waiting on inventory. The lines are estimates and nothing has moved yet."
    inakadiriwa
    "Confirmed. This is the only state in which the lines have moved stock."
    imethibitishwa
    "Replaced by a later submission before it was confirmed. Kept for the record, never queued, and it never moved stock."
    imebadilishwa
  }

  type Malighafi {
    id: ID!
    jina: String!
    kiasi_kilichopo: Float!
    kiwango_cha_chini: Float!
    unit: String
    """
    NOT YET IMPLEMENTED — this always resolves to null. It depends on recipe
    costing (the P2 feature), which does not exist yet. Do not build UI that
    reads this value; use kiasi_kilichopo against kiwango_cha_chini for
    low-stock indication until this is implemented.
    """
    asilimia_iliyotumika: Float
  }

  type MarekebishoHisa {
    id: ID!
    malighafi: Malighafi!
    aina: AinaMarekebisho!
    kiasi: Float!
    sababu: String
    created_by: Mtumiaji
    tarehe: DateTime!
  }

  type AllStock {
    items: [Malighafi!]!
    lowStock: [Malighafi!]!
  }

  type UtabiriHisa {
    malighafi: Malighafi!
    kiwango_cha_matumizi_kwa_siku: Float!
    siku_zilizobaki: Int!
    tarehe_kutabiriwa: Date!
    hali: String!
  }

  type KumbukumbuKitendo {
    id: ID!
    tarehe: DateTime!
    meza: String!
    kitendo: String!
    node_id: Int
    data_ya_kabla: JSON
    data_ya_baada: JSON
  }

  scalar JSON

  type Query {
    me: Mtumiaji
    wafanyakazi: [Mtumiaji!]!
    staff: [Mtumiaji!]!
    """
    Active staff only, for pickers such as the request composer. Every signed-in
    role can read this: it exposes nothing beyond the names already printed
    against orders, which is why it is separate from the "staff" query, which is
    gated on staff.manage and would otherwise leave the inventory clerk unable
    to address a request to anybody.
    """
    watumishi: [Mtumiaji!]!
    bidhaa(active: Boolean): [Bidhaa!]!
    wateja(search: String): [Mteja!]!
    agizo_maalum(hali: HaliOrder, tarehe_ya_kuchukua: Date): [AgizoMaalum!]!
    order_kwajikoni: [AgizoMaalum!]!
    mauzo(tarehe: Date, njia_ya_malipo: NjiaMalipo): [Mauzo!]!
    mauzo_ya_leo: [Mauzo!]!
    kumbukumbu_matumizi(agizo_id: ID, tarehe_kutoka: Date, tarehe_kutia: Date): [KumbukumbuMatumizi!]!
    "The chef's own submissions, so a sheet already written is visible and cannot be written twice by accident."
    zingumiaji_zangu: [ZingumiajiMatumizi!]!
    hisa: AllStock!
    "One ingredient with its real movement history, what the kitchen spends it on, and the daily balances behind them."
    maelezo_malighafi(id: ID!): MaelezoMalighafi
    malighafi: [Malighafi!]!
    "Omit both dates for the whole ledger. Both filter on the local (Tanzania) day."
    marekebisho_hisa(tarehe_kutoka: Date, tarehe_kutia: Date): [MarekebishoHisa!]!
    riport_dashboard: Dashboard!
    ukumbusho: [Ukumbusho!]!
    utabiri_hisa(kiasi_chini_ya_siku: Int): [UtabiriHisa!]!
    tikiti(tarehe: Date, hali: TikitiHali): [Tikiti!]!
    kumbukumbu_kitendo(meza: String, node_id: ID, kikomo: Int): [KumbukumbuKitendo!]!
    mapishi(active: Boolean): [Mapishi!]!
    "Estimated usage awaiting inventory's confirmation. Stock has not moved for these yet."
    kumbukumbu_matumizi_kusubiri: [KumbukumbuMatumizi!]!
    kategoria(active: Boolean): [Kategoria!]!
    "Everything you can see: records you sent, records addressed to you, and everything at all if you are the owner."
    ombi(fungua: Boolean, aina: AinaUkumbushoKazi): [Ombi!]!
  }

  type Dashboard {
    mauzo_ya_leo: [Mauzo!]!
    mauzo_ya_leo_total: Float!
    mauzo_kwa_njia: [SalaKwaNjia!]!
    mauzo_7_siku: [SikuMauzo!]!
    maagizo_ambayo_hajakusanywa: [AgizoMaalum!]!
    salio_jumla_ajira: Float!
    hisa_chini: [Malighafi!]!
    shughuli_za_jikoni: [AgizoMaalum!]!
  }

  type SikuMauzo {
    tarehe: Date!
    jumla: Float!
    risiti: Int!
  }

  type SalaKwaNjia {
    njia: NjiaMalipo!
    jumla: Float!
  }

  input BidhaaInput {
    jina: String!
    bei: Float!
    aina: String
    "Optional on create: derived from jina if omitted. Supply explicitly to set a family that does not match the name."
    familia: String
    ukubwa: String
    kategoria_id: ID
  }

  input MalighafiInput {
    jina: String!
    kiasi_kilichopo: Float!
    kiwango_cha_chini: Float!
    unit: String!
  }

  input MauzoBidhaaInput {
    bidhaa_id: ID!
    kiasi: Int!
  }

  input MtejaInput {
    jina: String!
    simu: String
    mzio: String
    siku_ya_kuzaliwa: Date
  }

  input OmbiInput {
    "Who this is for."
    kwenda_kwa: ID!
    aina: AinaUkumbushoKazi
    kipendeleo: KipendeleoUkumbushoKazi
    mada: String
    ujumbe: String!
    "Link the ingredient this concerns. Without it a procurement request is just prose."
    malighafi_id: ID
    kiasi: Float
    agizo_id: ID
    mwisho: Date
  }

    input AgizoInput {
      mteja_id: ID
      mteja_mpya: MtejaInput
      ladha: String!
      design: String
      ukubwa: String
      "Optional: pick a recipe from the book so the kitchen's tap sheet starts prefilled. Omit it and the order is treated as off-book/custom."
      mapishi_id: ID
      umbo: String
      maelekezo_maalum: String
        tarehe_ya_kuchukua: Date!
        "BR-05/D-28: omit this and the order is created awaiting_quote, and an owner is asked to price it. Supplying it keeps the old behaviour of pricing at the till."
        bei_jumla: Float
        malipo_ya_awali: Float!
      # How the deposit was paid. Optional so existing callers keep working; it
      # defaults to cash, and the till screen always sends it explicitly.
      njia_ya_malipo: NjiaMalipo
    }

  input MatumiziInput {
    agizo_id: ID!
    malighafi_id: ID!
    kiasi: Float!
  }

  input MatumiziKipengeleInput {
    malighafi_id: ID!
    kiasi: Float
    "The band the chef tapped, lower bound. Send it instead of kiasi so the sheet records what the chef chose rather than a number derived from it."
    kiasi_cha_chini: Float
    "Upper bound of the tapped band."
    kiasi_cha_juu: Float
    "Set when the chef marked this ingredient as not used, or added it themselves. Null means the chef tapped an amount."
    hali_sheeti: HaliSheeti
    "The recipe line this came from. Lets the same ingredient appear twice, once for the base and once for the frosting."
    mapishi_kipengele_id: ID
    sehemu: String
  }

  "One tap-submit of many ingredients. agizo_id is OPTIONAL: regular shop production has no order, so kumbukumbu (e.g. '20 mandazi') is what explains the entry."
  input MatumiziKundiInput {
    agizo_id: ID
    kumbukumbu: String
    vitu: [MatumiziKipengeleInput!]!
    "Replace an existing open sheet for this order instead of refusing. The old one is kept for the record; this is how a chef corrects a submission inventory has not confirmed yet."
    badilisha: Boolean
  }

  input MapishiKipengeleInput {
    malighafi_id: ID!
    kiasi_cha_chini: Float!
    kiasi_cha_juu: Float!
    sehemu: String
  }

  "One line of an inventory whole-sheet confirmation (BR-13). Inventory only overrides the lines that need it; omitted lines confirm at the chef's tapped midpoint."
  input KuchaguaMatumiziInput {
    id: ID!
    kiasi_halisi: Float
  }

  input MapishiInput {
    ladha: String!
    ukubwa: String!
    dakika_kadirio: Int
    mapamba_variant: String
    mapishi_ibaba: ID
    "Required when mapamba_variant is fraction_of, and must be between 0 and 1 exclusive."
    sehemu_ya_uzito: Float
    viambato: [MapishiKipengeleInput!]!
  }

  input MarekebishoInput {
    malighafi_id: ID!
    aina: AinaMarekebisho!
    kiasi: Float!
    sababu: String
  }

  input MtumiajiUpdateInput {
    jina: String
    jukumu: Jukumu
    pin: String
  }

  type Mutation {
    login(id: ID!, pin: String!): AuthPayload!
    bathi_bidhaa(input: BidhaaInput!): Bidhaa!
    ongeza_malighafi(input: MalighafiInput!): Malighafi!
    hariri_malighafi(id: ID!, input: MalighafiInput!): Malighafi!
    hariri_bidhaa(id: ID!, input: BidhaaInput!): Bidhaa!
    futa_bidhaa(id: ID!): Boolean!
    ongeza_mteja(input: MtejaInput!): Mteja!
    unda_mauzo(bidhaa: [MauzoBidhaaInput!]!, njia_ya_malipo: NjiaMalipo!, punguzo: Float): Mauzo!
    unda_agizo(input: AgizoInput!): AgizoMaalum!
    lipa_salio(id: ID!, kiasi: Float!, njia_ya_malipo: NjiaMalipo): MalipoJumla!
    badge_hali_order(id: ID!, hali: HaliOrder!): AgizoMaalum!
    chukua_agizo(id: ID!): AgizoMaalum!
    futa_agizo(id: ID!): Boolean!
    log_matumizi(input: MatumiziInput!): KumbukumbuMatumizi!
    "The chef's tap logging: many ingredients in one submit. Stock does NOT move here — this records an estimate."
    log_matumizi_kundi(input: MatumiziKundiInput!): [KumbukumbuMatumizi!]!
    "Inventory confirms the real number. This is the point stock actually moves."
    thibitisha_matumizi(id: ID!, kiasi_halisi: Float!): KumbukumbuMatumizi!    "BR-13: confirm a whole usage sheet and close its auto-raised request in one atomic step. Each line may carry an exact kiasi_halisi; a line omitted from kuchagua is confirmed at the chef's own tapped midpoint. This is the point stock actually moves."
    thibitisha_matumizi_kundi(zingumiaji_id: ID!, kuchagua: [KuchaguaMatumiziInput!]): ZingumiajiMatumizi!
    "BR-05/D-28: the owner prices an order that is awaiting_quote. This is the only way a custom cake gets its price, and it moves the order to 'ordered' so the kitchen and till can act on it."
    toa_bei(id: ID!, bei: Float!, malipo_ya_awali: Float, njia_ya_malipo: NjiaMalipo): AgizoMaalum!

    unda_mapishi(input: MapishiInput!): Mapishi!
    hariri_mapishi(id: ID!, input: MapishiInput!): Mapishi!
    futa_mapishi(id: ID!): Boolean!

    unda_kategoria(jina: String!): Kategoria!
    hariri_kategoria(id: ID!, jina: String!): Kategoria!
    "Retire a category. Refused while products still point at it, so a category can never vanish out from under them."
    futa_kategoria(id: ID!): Boolean!
    "Bulk action: move many products into one category at once."
    panga_kategoria(bidhaa_ids: [ID!]!, kategoria_id: ID!): Int!

    "Raise a request or issue a directive. The direction is the only difference: an ombi asks, a direktive instructs. Starts in imeandikwa so it can be corrected before anybody is told."
    tuma_ombi(input: OmbiInput!): Ombi!
    "Move a request or directive to its next state. The backend decides which states are reachable and refuses the rest, so a client cannot jump a record from 'sent' to 'completed'."
    sasisha_ombi(id: ID!, hali: HaliOmbi!, jibu: String): Ombi!
    "Close out finished work. Records who did it and when."
    kamilisha_ombi(id: ID!, jibu: String): Ombi!
    "Withdraw a record that has not been finished."
    ghairi_ombi(id: ID!, sababu: String): Ombi!

    marekebisho_hisa(input: MarekebishoInput!): MarekebishoHisa!
    ongeza_mfanyakazi(jina: String!, jukumu: Jukumu!, pin: String!): Mtumiaji!
    hariri_mfanyakazi(id: ID!, input: MtumiajiUpdateInput!): Mtumiaji!
    futa_mfanyakazi(id: ID!): Boolean!
    soma_ukumbusho(id: ID!): Ukumbusho!
    tengeneza_ukumbusho: Boolean!
    chukua_tikiti(id: ID!): Tikiti!
    futa_tikiti(id: ID!): Boolean!
    badge_hali_tikiti(id: ID!, hali: TikitiHali!): Tikiti!
  }
`;