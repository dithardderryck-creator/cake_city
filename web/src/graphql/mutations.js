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

export const TUMIA_OMBI = gql`
  mutation TumiaOmbi($kwenda_kwa: ID!, $ujumbe: String!) {
    tumia_ombi(kwenda_kwa: $kwenda_kwa, ujumbe: $ujumbe) { id ujumbe hali }
  }
`

export const FUNGUA_OMBI = gql`
  mutation FungaOmbi($id: ID!, $jibu: String) {
    fungua_ombi(id: $id, jibu: $jibu) { id hali jibu }
  }
`
