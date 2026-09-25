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
  }

  type Mteja {
    id: ID!
    jina: String!
    simu: String
    siku_ya_kuzaliwa: Date
    created_at: DateTime
  }

  type AgizoMaalum {
    id: ID!
    mteja: Mteja
    ladha: String!
    design: String
    ukubwa: String
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
  }

  type KumbukumbuMatumizi {
    id: ID!
    agizo: AgizoMaalum
    malighafi: Malighafi!
    kiasi: Float!
    mpishi: Mtumiaji
    tarehe: DateTime!
  }

  type Malighafi {
    id: ID!
    jina: String!
    kiasi_kilichopo: Float!
    kiwango_cha_chini: Float!
    unit: String
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
    bidhaa(active: Boolean): [Bidhaa!]!
    wateja(search: String): [Mteja!]!
    agizo_maalum(hali: HaliOrder, tarehe_ya_kuchukua: Date): [AgizoMaalum!]!
    order_kwajikoni: [AgizoMaalum!]!
    mauzo(tarehe: Date, njia_ya_malipo: NjiaMalipo): [Mauzo!]!
    mauzo_ya_leo: [Mauzo!]!
    kumbukumbu_matumizi(agizo_id: ID): [KumbukumbuMatumizi!]!
    hisa: AllStock!
    malighafi: [Malighafi!]!
    marekebisho_hisa: [MarekebishoHisa!]!
    riport_dashboard: Dashboard!
    ukumbusho: [Ukumbusho!]!
    utabiri_hisa(kiasi_chini_ya_siku: Int): [UtabiriHisa!]!
    tikiti(tarehe: Date, hali: TikitiHali): [Tikiti!]!
    kumbukumbu_kitendo(meza: String, node_id: ID, kikomo: Int): [KumbukumbuKitendo!]!
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
    siku_ya_kuzaliwa: Date
  }

  input AgizoInput {
    mteja_id: ID
    mteja_mpya: MtejaInput
    ladha: String!
    design: String
    ukubwa: String
    tarehe_ya_kuchukua: Date!
    bei_jumla: Float!
    malipo_ya_awali: Float!
  }

  input MatumiziInput {
    agizo_id: ID!
    malighafi_id: ID!
    kiasi: Float!
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
    badge_hali_order(id: ID!, hali: HaliOrder!): AgizoMaalum!
    chukua_agizo(id: ID!): AgizoMaalum!
    futa_agizo(id: ID!): Boolean!
    log_matumizi(input: MatumiziInput!): KumbukumbuMatumizi!
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