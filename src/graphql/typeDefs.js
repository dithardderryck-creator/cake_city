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
  }

  "A request from one staff member to another. Distinct from Ukumbusho, which is computer-generated."
  type Ombi {
    id: ID!
    kutoka_kwa: Mtumiaji!
    kwenda_kwa: Mtumiaji!
    ujumbe: String!
    hali: HaliOmbi!
    jibu: String
    tarehe_ya_kufunguliwa: DateTime
    created_at: DateTime!
  }

  enum HaliOmbi {
    fungua
    imefanyika
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
    "Optional: pick a recipe from the book so the kitchen's tap sheet starts prefilled. Omit it and the order is treated as off-book/custom."
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

  type KumbukumbuMatumizi {
    id: ID!
    agizo: AgizoMaalum
    malighafi: Malighafi!
    "What the chef logged. Possibly mid-range. Never moves stock on its own."
    kiasi: Float!
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
    inakadiriwa
    imethibitishwa
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
    "fungua: only open requests. Omit for everything."
    ombi(fungua: Boolean): [Ombi!]!
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
      bei_jumla: Float!
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
    kiasi: Float!
  }

  "One tap-submit of many ingredients. agizo_id is OPTIONAL: regular shop production has no order, so kumbukumbu (e.g. '20 mandazi') is what explains the entry."
  input MatumiziKundiInput {
    agizo_id: ID
    kumbukumbu: String
    vitu: [MatumiziKipengeleInput!]!
  }

  input MapishiKipengeleInput {
    malighafi_id: ID!
    kiasi_cha_chini: Float!
    kiasi_cha_juu: Float!
    sehemu: String
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
    thibitisha_matumizi(id: ID!, kiasi_halisi: Float!): KumbukumbuMatumizi!

    unda_mapishi(input: MapishiInput!): Mapishi!
    hariri_mapishi(id: ID!, input: MapishiInput!): Mapishi!
    futa_mapishi(id: ID!): Boolean!

    unda_kategoria(jina: String!): Kategoria!
    hariri_kategoria(id: ID!, jina: String!): Kategoria!
    "Retire a category. Refused while products still point at it, so a category can never vanish out from under them."
    futa_kategoria(id: ID!): Boolean!
    "Bulk action: move many products into one category at once."
    panga_kategoria(bidhaa_ids: [ID!]!, kategoria_id: ID!): Int!

    "Ask another member of staff for something. Does not move stock."
    tumia_ombi(kwenda_kwa: ID!, ujumbe: String!): Ombi!
    "Clear a request. Only the person it was addressed to may do this."
    fungua_ombi(id: ID!, jibu: String): Ombi!

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