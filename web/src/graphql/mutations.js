import { gql } from '@apollo/client'

export const UNDA_MAUZO = gql`
  mutation UndaMauzo($bidhaa: [MauzoBidhaaInput!]!, $njiaYaMlipo: NjiaMalipo!, $punguzo: Float) {
    unda_mauzo(bidhaa: $bidhaa, njia_ya_malipo: $njiaYaMlipo, punguzo: $punguzo) {
      id jumla risiti_no njia_ya_malipo
      tikiti { id namba tarehe aina hali jina maelezo jumla }
    }
  }
`

export const UNDA_AGIZO = gql`
  mutation UndaAgizo($input: AgizoInput!) {
    unda_agizo(input: $input) {
      id ladha ukubwa umbo maelekezo_maalum bei_jumla malipo_ya_awali salio hali
      mteja { id jina simu mzio }
      tikiti { id namba tarehe aina hali jina maelezo jumla }
      malipo { id jumla njia_ya_malipo risiti_no }
    }
  }
`

export const LIPA_SALIO = gql`
  mutation LipaSalio($id: ID!, $kiasi: Float!, $njia_ya_malipo: NjiaMalipo) {
    lipa_salio(id: $id, kiasi: $kiasi, njia_ya_malipo: $njia_ya_malipo) {
      agizo { id ladha bei_jumla malipo_ya_awali salio hali }
      malipo { id jumla njia_ya_malipo risiti_no }
    }
  }
`

export const BADGE_HALI_ORDER = gql`
  mutation BadgeHaliOrder($id: ID!, $hali: HaliOrder!) {
    badge_hali_order(id: $id, hali: $hali) { id hali }
  }
`

export const CHUKUA_AGIZO = gql`
  mutation ChukuaAgizo($id: ID!) {
    chukua_agizo(id: $id) { id hali }
  }
`

export const FUTA_AGIZO = gql`
  mutation FutaAgizo($id: ID!) {
    futa_agizo(id: $id)
  }
`

export const LOG_MATUMIZI = gql`
  mutation LogMatumizi($input: MatumiziInput!) {
    log_matumizi(input: $input) {
      id kiasi tarehe
      malighafi { id jina unit }
    }
  }
`

export const MAREKEBISHO_HISA_MUT = gql`
  mutation MarekebishoHisa($input: MarekebishoInput!) {
    marekebisho_hisa(input: $input) {
      id aina kiasi
      malighafi { id jina }
    }
  }
`

export const BATHI_BIDHAA = gql`
  mutation BathiBidhaa($input: BidhaaInput!) {
    bathi_bidhaa(input: $input) { id jina bei aina }
  }
`

export const ONGEZA_MALIGHAFI = gql`
  mutation OngezaMalighafi($input: MalighafiInput!) {
    ongeza_malighafi(input: $input) { id jina kiasi_kilichopo kiwango_cha_chini unit }
  }
`

export const HARIRI_MALIGHAFI = gql`
  mutation HaririMalighafi($id: ID!, $input: MalighafiInput!) {
    hariri_malighafi(id: $id, input: $input) { id jina kiasi_kilichopo kiwango_cha_chini unit }
  }
`

export const HARIRI_BIDHAA = gql`
  mutation HaririBidhaa($id: ID!, $input: BidhaaInput!) {
    hariri_bidhaa(id: $id, input: $input) { id jina bei aina }
  }
`

export const FUTA_BIDHAA = gql`
  mutation FutaBidhaa($id: ID!) {
    futa_bidhaa(id: $id)
  }
`

export const ONGEZA_MFANYAKAZI = gql`
  mutation OngezaMfanyakazi($jina: String!, $jukumu: Jukumu!, $pin: String!) {
    ongeza_mfanyakazi(jina: $jina, jukumu: $jukumu, pin: $pin) { id jina jukumu }
  }
`

export const HARIRI_MFANYAKAZI = gql`
  mutation HaririMfanyakazi($id: ID!, $input: MtumiajiUpdateInput!) {
    hariri_mfanyakazi(id: $id, input: $input) { id jina jukumu }
  }
`

export const FUTA_MFANYAKAZI = gql`
  mutation FutaMfanyakazi($id: ID!) {
    futa_mfanyakazi(id: $id)
  }
`

export const SOMA_UKUMBUSHO = gql`
  mutation SomaUkumbusho($id: ID!) {
    soma_ukumbusho(id: $id) { id imesomwa }
  }
`

export const CHUKUA_TIKITI = gql`
  mutation ChukuaTikiti($id: ID!) {
    chukua_tikiti(id: $id) { id namba hali }
  }
`

export const FUTA_TIKITI = gql`
  mutation FutaTikiti($id: ID!) {
    futa_tikiti(id: $id)
  }
`

export const BADGE_HALI_TIKITI = gql`
  mutation BadgeHaliTikiti($id: ID!, $hali: TikitiHali!) {
    badge_hali_tikiti(id: $id, hali: $hali) { id namba hali }
  }
`
// ---------------------------------------------------------------------------
// Chef tap logging. Records an ESTIMATE only: stock moves later, when
// inventory confirms the real number via THIBITISHA_MATUMIZI.
// ---------------------------------------------------------------------------

export const LOG_MATUMIZI_KUNDI = gql`
  mutation LogMatumiziKundi($input: MatumiziKundiInput!) {
    log_matumizi_kundi(input: $input) {
      id kiasi kumbukumbu hali
      malighafi { id jina unit }
    }
  }
`

export const THIBITISHA_MATUMIZI = gql`
  mutation ThibitishaMatumizi($id: ID!, $kiasi_halisi: Float!) {
    thibitisha_matumizi(id: $id, kiasi_halisi: $kiasi_halisi) {
      id kiasi kiasi_halisi hali
      imethibitishwa_na { id jina }
    }
  }
`

// --- Recipes ---------------------------------------------------------------

export const UNDA_MAPISHI = gql`
  mutation UndaMapishi($input: MapishiInput!) {
    unda_mapishi(input: $input) { id ladha ukubwa }
  }
`

export const HARIRI_MAPISHI = gql`
  mutation HaririMapishi($id: ID!, $input: MapishiInput!) {
    hariri_mapishi(id: $id, input: $input) { id ladha ukubwa }
  }
`

export const FUTA_MAPISHI = gql`
  mutation FutaMapishi($id: ID!) { futa_mapishi(id: $id) }
`

// --- Categories ------------------------------------------------------------

export const UNDA_KATEGORIA = gql`
  mutation UndaKategoria($jina: String!) { unda_kategoria(jina: $jina) { id jina } }
`

export const HARIRI_KATEGORIA = gql`
  mutation HaririKategoria($id: ID!, $jina: String!) {
    hariri_kategoria(id: $id, jina: $jina) { id jina }
  }
`

export const FUTA_KATEGORIA = gql`
  mutation FutaKategoria($id: ID!) { futa_kategoria(id: $id) }
`

/** Bulk action: move many products into one category at once. */
export const PANGA_KATEGORIA = gql`
  mutation PangaKategoria($bidhaa_ids: [ID!]!, $kategoria_id: ID!) {
    panga_kategoria(bidhaa_ids: $bidhaa_ids, kategoria_id: $kategoria_id)
  }
`

// --- Staff requests --------------------------------------------------------

/**
 * One mutation raises either a request or a directive; `aina` says which way the
 * intent points. Linking the ingredient and a quantity is what makes a
 * procurement request able to drive a reorder rather than sitting as prose.
 */
export const TUMA_OMBI = gql`
  mutation TumaOmbi(
    $kwenda_kwa: ID!, $ujumbe: String!, $mada: String
    $aina: AinaUkumbushoKazi, $kipendeleo: KipendeleoUkumbushoKazi
    $malighafi_id: ID, $kiasi: Float, $agizo_id: ID, $mwisho: Date
  ) {
    tuma_ombi(input: {
      kwenda_kwa: $kwenda_kwa, ujumbe: $ujumbe, mada: $mada
      aina: $aina, kipendeleo: $kipendeleo
      malighafi_id: $malighafi_id, kiasi: $kiasi
      agizo_id: $agizo_id, mwisho: $mwisho
    }) { id mada ujumbe aina kipendeleo kiasi mwisho hali }
  }
`

/**
 * Move a request or directive to a new state. The backend owns which moves are
 * legal, so the client sends the state it wants and is told "no" when that move
 * does not exist. That is deliberate: a screen that hides an illegal button still
 * has to be safe when the button is pressed anyway.
 */
export const SASISHA_OMBI = gql`
  mutation SasisbaOmbi($id: ID!, $hali: HaliOmbi!, $jibu: String) {
    sasisha_ombi(id: $id, hali: $hali, jibu: $jibu) { id hali jibu alizokamilisha_at }
  }
`

export const KAMILISHA_OMBI = gql`
  mutation KamilishaOmbi($id: ID!, $jibu: String) {
    kamilisha_ombi(id: $id, jibu: $jibu) { id hali jibu alizokamilisha_at }
  }
`

export const GHAIRI_OMBI = gql`
  mutation GhairiOmbi($id: ID!, $sababu: String) {
    ghairi_ombi(id: $id, sababu: $sababu) { id hali jibu }
  }
`

/**
 * BR-05/D-28: the owner's answer to a quote request. The only way an
 * awaiting_quote order becomes ordered, and the only way the cashier's
 * described cake gets a price. The response carries the kitchen ticket, so
 * the owner can see the job actually reached production.
 */
export const TOA_BEI = gql`
  mutation ToaBei($id: ID!, $bei: Float!, $malipo_ya_awali: Float, $njia_ya_malipo: NjiaMalipo) {
    toa_bei(id: $id, bei: $bei, malipo_ya_awali: $malipo_ya_awali, njia_ya_malipo: $njia_ya_malipo) {
      id ladha hali bei_jumla malipo_ya_awali salio
      tikiti { id namba }
    }
  }
`
