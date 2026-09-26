import { gql } from '@apollo/client'

export const BIDHAA = gql`
  query Bidhaa { bidhaa { id jina bei aina } }
`

export const WATEJA = gql`
  query Wateja($search: String) { wateja(search: $search) { id jina simu siku_ya_kuzaliwa } }
`

export const ORDER_KWAJIKONI = gql`
  query OrderKwajikoni {
    order_kwajikoni {
      id ladha design ukubwa tarehe_ya_kuchukua hali muda_hitajika
      mapishi {
        id ladha ukubwa dakika_kadirio
        viambato {
          id sehemu kiasi_cha_chini kiasi_cha_juu
      malighafi { id jina unit kiasi_kilichopo }
        }
      }
    }
  }
`

export const AGIZO_MAALUM = gql`
  query AgizoMaalum($hali: HaliOrder, $tarehe: Date) {
    agizo_maalum(hali: $hali, tarehe_ya_kuchukua: $tarehe) {
      id ladha design ukubwa tarehe_ya_kuchukua
      bei_jumla malipo_ya_awali salio hali muda_hitajika
      mteja { id jina simu }
    }
  }
`

export const MAUZO = gql`
  query Mauzo($tarehe: Date) {
    mauzo(tarehe: $tarehe) {
      id tarehe jumla njia_ya_malipo risiti_no created_at
      mfanyakazi { id jina }
      bidhaa { id kiasi bei bidhaa { jina } }
    }
  }
`

export const MAUZO_YA_LEO = gql`
  query MauzoYaLeo {
      mauzo_ya_leo {
          id tarehe jumla njia_ya_malipo risiti_no created_at agizo_id
          bidhaa { id kiasi bei bidhaa { jina } }
        }
  }
`

export const KUMBUKUMU_MATUMIZI = gql`
  query KumbukumbuMatumizi($agizoId: ID) {
    kumbukumbu_matumizi(agizo_id: $agizoId) {
      id kiasi kiasi_halisi hali tarehe
      malighafi { id jina unit }
      mpishi { id jina }
      agizo { id ladha }
    }
  }
`

export const HISA = gql`
  query Hisa {
    hisa {
      items { id jina kiasi_kilichopo kiwango_cha_chini unit }
      lowStock { id jina kiasi_kilichopo kiwango_cha_chini unit }
    }
  }
`

export const MALIGHAFI = gql`
  query Malighafi {
    malighafi { id jina kiasi_kilichopo kiwango_cha_chini unit }
  }
`

export const MAREKEBISHO_HISA = gql`
  query MarekebishoHisa {
    marekebisho_hisa {
      id aina kiasi sababu tarehe
      malighafi { id jina unit }
      created_by { id jina }
    }
  }
`

export const STAFF = gql`
  query Staff {
    staff { id jina jukumu active }
  }
`

export const RIPORT_DASHBOARD = gql`
  query RiportDashboard {
    riport_dashboard {
      mauzo_ya_leo_total
        mauzo_ya_leo { id tarehe jumla njia_ya_malipo risiti_no created_at }
      mauzo_kwa_njia { njia jumla }
      mauzo_7_siku { tarehe jumla risiti }
      maagizo_ambayo_hajakusanywa {
        id ladha ukubwa tarehe_ya_kuchukua salio muda_hitajika
        mteja { jina simu }
      }
      salio_jumla_ajira
      hisa_chini { id jina kiasi_kilichopo kiwango_cha_chini unit }
      shughuli_za_jikoni {
        id ladha design ukubwa tarehe_ya_kuchukua hali muda_hitajika
      }
    }
  }
`

export const UKUMBUSHO = gql`
  query Ukumbusho {
    ukumbusho {
      id aina lengo ujumbe
      tarehe_ya_utekelezaji muda_inayopendekezwa imesomwa
      agizo { id ladha ukubwa tarehe_ya_kuchukua }
      malighafi { id jina unit kiasi_kilichopo }
    }
  }
`

export const UTABIRI_HISA = gql`
  query UtabiriHisa($kiasi_chini_ya_siku: Int) {
    utabiri_hisa(kiasi_chini_ya_siku: $kiasi_chini_ya_siku) {
      malighafi { id jina kiasi_kilichopo kiwango_cha_chini unit }
      kiwango_cha_matumizi_kwa_siku siku_zilizobaki tarehe_kutabiriwa hali
    }
  }
`

export const TIKITI = gql`
  query Tikiti($tarehe: Date) {
    tikiti(tarehe: $tarehe) {
      id namba tarehe aina hali jina maelezo jumla created_at updated_at
      mauzo_id agizo_id
      mauzo { id risiti_no njia_ya_malipo }
      agizo { id ladha ukubwa hali }
    }
  }
`

export const KUMBUKUMBU_KITENDO = gql`
  query KumbukumbuKitendo($meza: String, $kikomo: Int) {
    kumbukumbu_kitendo(meza: $meza, kikomo: $kikomo) {
      id tarehe meza kitendo node_id
      data_ya_kabla data_ya_baada
    }
  }
`
// ---------------------------------------------------------------------------
// Recipes, ingredient usage verification, categories, and staff requests.
// ---------------------------------------------------------------------------

export const MAPISHI = gql`
  query Mapishi {
    mapishi {
      id ladha ukubwa dakika_kadirio mapamba_variant
      mapishi_ibaba { id ladha ukubwa }
      viambato {
        id sehemu kiasi_cha_chini kiasi_cha_juu
        malighafi { id jina unit kiasi_kilichopo }
      }
    }
  }
`

/** The verification queue, with enough context to sanity-check each number. */
export const MATUMIZI_KUSUBIRI = gql`
  query MatumiziKusubiri {
    kumbukumbu_matumizi_kusubiri {
      id kiasi kumbukumbu hali tarehe
      agizo_ladha agizo_ukubwa mapishi_ladha mapishi_ukubwa
      malighafi { id jina unit }
      mpishi { id jina }
    }
  }
`

export const KATEGORIA = gql`
  query Kategoria {
    kategoria {
      id jina
      bidhaa { id jina familia ukubwa bei active }
    }
  }
`

/** Both directions, so you can see what you sent as well as what came in. */
export const OMBI = gql`
  query Ombi {
    ombi { id ujumbe jibu hali created_at tarehe_ya_kufunguliwa
           kutoka_kwa { id jina jukumu }
           kwenda_kwa { id jina jukumu } }
  }
`
