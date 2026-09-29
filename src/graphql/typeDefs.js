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
    "BR-26: the till this session belongs to, or null if it was not registered. Shown in settings so an owner can see which device is issuing order numbers."
    kifaa: Kifaa
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
    "§4.2/D-26: the axes of variation this product has, in the order the owner arranged them. Empty means the product is a grid of one and its single combination carries the price."
    makundi: [ChagizoKundi!]!
    "Every version of this product with a price and a stock count (D-27). A product with no variations has exactly one."
    mchanganyiko: [Mchanganyiko!]!
    "True when the product is priced and stocked per combination rather than as a single thing."
    kuna_mchanganyiko: Boolean!
  }

  "§4.2 OptionGroup: one axis of variation, from a library shared across products. Size, Filling, Dietary."
  type ChagizoKundi {
    id: ID!
    jina: String!
    "Q-03: 'moja' means the customer picks one value, 'nyingi' means several. Resolved per group rather than as a schema fork, so a shop can have Size single and Dietary multi at the same time."
    uteuzi: UteuziChagizo!
    "A required group must be answered on every combination of the products that use it."
    inahitaji: Boolean!
    active: Boolean!
    thamani: [ChagizoThamani!]!
    "How many products currently use this group."
    bidhaa_zinazotumia: Int!
    "How many values, times how many ways they can be combined. This is the size of the grid the owner is about to create."
    uwezekano: Int!
  }

  enum UteuziChagizo {
    "The customer picks exactly one value from the group."
    moja
    "The customer picks several values from the group."
    nyingi
  }

  "§4.2 OptionValue: one choice on an axis, e.g. '8-inch' or 'Eggless'."
  type ChagizoThamani {
    id: ID!
    kundi: ChagizoKundi!
    jina: String!
    "Declared allergens. A combination's allergen list is the union of its values', so a snapshot frozen at order time (BR-11) can be trusted."
    viambisho: [String!]!
    active: Boolean!
  }

  "§4.2 Combination: one specific version of a product, with its own price and stock count. 'Chocolate Fudge, 8-inch, Vanilla cream, Eggless'."
  type Mchanganyiko {
    id: ID!
    bidhaa: Bidhaa!
    "D-27: set by the owner by hand. There is no price rule engine, and none is coming."
    bei: Float!
    "A-14: every available combination carries a stock count."
    hesafa: Int!
    status: HaliMchanganyiko!
    "The values chosen, grouped by axis, in the order the owner arranged the axes."
    thamani: [ThamaniYaMchanganyiko!]!
    "The union of the chosen values' declared allergens, sorted and deduped."
    viambisho: [String!]!
    "A human-readable label, frozen at creation so an old order still reads correctly after a rename (BR-11)."
    maelezo: String
  }

  "One chosen value, carrying its group so the picker knows which axis to put it under."
  type ThamaniYaMchanganyiko {
    thamani: ChagizoThamani!
    kundi: ChagizoKundi!
  }

  enum HaliMchanganyiko {
    patikana
    "Marked unavailable rather than deleted. This is how a combination that should not exist is retired (§4.2) — it replaces any rules engine."
    haipatikani
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
        "BR-26: the human-readable order number, unique across devices. Safe to read aloud at a counter. This is the number, not id."
        nambari: String
        "BR-01: the order's lines, catalogue and custom, in the order they were added. This is what the order is made of."
        kipimo: [AgizoKipimo!]!
        "True while any line still has bei <= 0 (unquoted custom). False means every line is priced and the kitchen can start."
        kipimo_bado: Boolean!
        "BR-01: whether this order mixes both kinds of line. Relevant because A-07 derives the order status from its lines in that case."
        ina_katalogi_na_custom: Boolean!
        chanzo: AgizoChanzo
        njia_ya_kutimiza: NjiaYaKutimiza
        "Required by the database whenever njia_ya_kutimiza is delivery, so a delivery order cannot exist without somewhere to go."
        anwani_ya_kuleta: String
      }

    enum AgizoChanzo { walk_in phone }
    enum NjiaYaKutimiza { pickup delivery }

    "BR-01: one line of an order. A catalogue line is sold from stock at a price the owner already set; a custom line is made to order and priced by quote. An order can hold any mix."
    type AgizoKipimo {
      id: ID!
      agizo_id: ID!
      aina: AinaYaKipimo!
      "Live pointer to the combination this was sold from, for stock and reports. Nullable and ON DELETE SET NULL, because the snapshot below is the real record — an archived combination must not take an order's history with it."
      mchanganyiko_id: ID
      mchanganyiko: Mchanganyiko
      "BR-11: the frozen record. What this line was at the moment it was entered — product name, chosen options, allergens, price. Deliberately not read from the catalogue, which has moved on since."
      jina: String!
      chaguo: [String!]!
      viambisho: [String!]!
      bei: Float!
      kiasi: Int!
      "D-42: the attributes that change what is baked. Blank on a catalogue line, where the combination already encodes them."
      kimo: String
      ladha_za_chakula: String
      kijazi: String
      tabaka: Int
      mzabibu: String
      "Free text. The kitchen reads this, so an inscription or decoration note lives here rather than in a structured field."
      maelezo: String
      created_at: DateTime
    }

    enum AinaYaKipimo { katalogi custom }

    input KifaaInput {
      "The device prefix, short and read aloud. Must be unique across the shop."
      alama: String!
      jina: String!
    }

    "BR-26: a till or panel. The prefix keeps order numbers unique across devices when two tills are in the same shop or a device was offline."
    type Kifaa {
      id: ID!
      alama: String!
      jina: String!
      active: Boolean!
      "Today's highest sequence number for this device, for showing an operator what the next one will be."
      kiakili: Int!
      tarehe_namba: Date
    }

    "One line to add to an order. Either kind, not both: a catalogue line names a combination, a custom line names recipe attributes."
    input KipimoInput {
      aina: AinaYaKipimo!
      "Catalogue line. Its price comes from the combination, never from the client (BR-02)."
      mchanganyiko_id: ID
      kiasi: Int
      "Custom line. The recipe attributes, D-42."
      kimo: String
      ladha_za_chakula: String
      kijazi: String
      tabaka: Int
      mzabibu: String
      maelezo: String
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
    "One product with its axes and every combination. The combination picker needs the whole grid for a product in one round trip, not N."
    bidhaa_moja(id: ID!): Bidhaa
    "The option library (§4.2), shared across products. Includes archived groups so the owner can see and restore them."
    makundi_zote(active: Boolean): [ChagizoKundi!]!
    "One product's grid, in the order the owner arranged the axes. What the sell screen renders."
    gridi_ya_bidhaa(bidhaa_id: ID!): [ChagizoKundi!]!
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

  input ChagizoKundiInput {
    jina: String!
    uteuzi: UteuziChagizo = moja
    inahitaji: Boolean = true
  }

  input ChagizoThamaniInput {
    kundi_id: ID!
    jina: String!
    viambisho: [String!]
  }

  "Correct a value already in the library. The owner gets names and allergens wrong sometimes, and with no way to correct them the only options are a wrong catalogue or a duplicate value. kundi_id is deliberately absent: moving a value between axes is a different operation, because the combinations that used it would need rebuilding."
  input HaririThamaniInput {
    jina: String!
    viambisho: [String!]
  }

  "Attach a group to a product, in the order the axes should appear on the sell screen."
  input WekaMakundiInput {
    bidhaa_id: ID!
    kundi_id: [ID!]!
  }

  "§4.2: generate the grid from the selected values, so the owner fills in prices instead of creating rows. Every generated combination starts unavailable and unpriced-able: the owner sets each price (D-27) and each one must be decided before it can be sold."
  input TengenezaMchanganyikoInput {
    bidhaa_id: ID!
    "Which values to build from, per group. A group left out of the map is skipped rather than silently defaulted."
    thamani: [ID!]!
    "Applied to every generated combination. Products with a single value need not be touched one by one (fill a column)."
    bei_mwanzoni: Float
  }

  "Bulk price helpers (§4.2): fill a column, copy a price across fillings."
  input BeiMchanganyikoInput {
    mchanganyiko: [ID!]!
    bei: Float!
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
        "Legacy only when kipimo is omitted: becomes the price of a synthesised custom line. Ignored when kipimo[] is sent — the sum of line prices wins."
        bei_jumla: Float
        malipo_ya_awali: Float!
      njia_ya_malipo: NjiaMalipo
      "§4.4: walk_in or phone. Decided once at entry and reported on."
      chanzo: AgizoChanzo
      "§4.4: pickup or delivery."
      njia_ya_kutimiza: NjiaYaKutimiza
      "Required by the database when njia_ya_kutimiza is delivery. A delivery order with no address is refused rather than queued."
      anwani_ya_kuleta: String
      "BR-01: the order's lines. Required for the lines model; omit only for the legacy single-cake path (a custom line is synthesised from ladha/ukubwa)."
      kipimo: [KipimoInput!]
    }

    input ToaBeiKipimoInput {
      kipimo_id: ID!
      "Unit price for this line. Required when the order has more than one unpriced custom line."
      bei: Float!
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
    "BR-26: sign in, identifying which till this is. Sent once by the panel at install. An omitted or unregistered till logs in normally but issues no order numbers."
  login(id: ID!, pin: String!, kifaa: String): AuthPayload!
    bathi_bidhaa(input: BidhaaInput!): Bidhaa!
    ongeza_malighafi(input: MalighafiInput!): Malighafi!
    hariri_malighafi(id: ID!, input: MalighafiInput!): Malighafi!
    hariri_bidhaa(id: ID!, input: BidhaaInput!): Bidhaa!
    "BR-10: archives rather than deletes. An archived product leaves the sell screen and stays in every record that already points at it."
    futa_bidhaa(id: ID!): Boolean!

    "A-01: only the owner manages products, combinations and prices. The shared option library is a separate permission so the owner can hand the library to someone without handing over prices."
    ongeza_kundi(input: ChagizoKundiInput!): ChagizoKundi!
    hariri_kundi(id: ID!, input: ChagizoKundiInput!): ChagizoKundi!
    ongeza_thamani(input: ChagizoThamaniInput!): ChagizoThamani!
  "Correct a value's name or allergens. This changes what the catalogue says from now on and deliberately does NOT touch combinations that already used it — those lines hold their own frozen copy (BR-11)."
  hariri_thamani(id: ID!, input: HaririThamaniInput!): ChagizoThamani!
    futa_thamani(id: ID!): Boolean!
    weka_makundi_za_bidhaa(input: WekaMakundiInput!): Bidhaa!
    "§4.2: build the grid, then fill in prices. Re-running adds only the combinations that do not exist yet, so it never discards a price already set."
    tengeneza_mchanganyiko(input: TengenezaMchanganyikoInput!): [Mchanganyiko!]!
    "D-27: the owner sets each price. Bulk, because a grid of 24 combinations should not be typed one at a time."
    weka_bei_ya_mchanganyiko(input: BeiMchanganyikoInput!): [Mchanganyiko!]!
    "§4.2: a combination that should not exist is marked unavailable. This is what replaces a rules engine."
    weka_hali_ya_mchanganyiko(id: ID!, status: HaliMchanganyiko!): Mchanganyiko!
    ongeza_mteja(input: MtejaInput!): Mteja!
    unda_mauzo(bidhaa: [MauzoBidhaaInput!]!, njia_ya_malipo: NjiaMalipo!, punguzo: Float): Mauzo!
      unda_agizo(input: AgizoInput!): AgizoMaalum!
      "BR-01: add a line to an order. A catalogue line takes its price from the combination, never from the client (BR-02), and the combination's name, options and allergens are frozen onto the line (BR-11)."
      ongeza_kipimo(id: ID!, input: KipimoInput!): AgizoKipimo!
      "Remove a line. Refused once the order is collected or cancelled — history is not editable at that point."
      ondoa_kipimo(kipimo_id: ID!): Boolean!
      "BR-26: register this till so it can issue order numbers. Called once at install; the prefix is what stops two devices handing out the same number."
      sajili_kifaa(input: KifaaInput!): Kifaa!
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
    "BR-05/D-28: the owner prices an order that is awaiting_quote. Writes the quote onto unpriced custom lines and sets bei_jumla from SUM(bei*kiasi). malipo_ya_awali is ADDITIONAL money taken at quote time — existing deposits are kept. When more than one line needs a price, pass kipimo: [{kipimo_id, bei}]."
    toa_bei(id: ID!, bei: Float!, malipo_ya_awali: Float, njia_ya_malipo: NjiaMalipo, kipimo: [ToaBeiKipimoInput!]): AgizoMaalum!

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