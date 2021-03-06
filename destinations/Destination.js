import { isDefined } from '../utils/is-defined'
import { shopInstance } from '../utils/axiosInstance'

export default class Destination {
  constructor(params) {
    // id can be added later
    this.id = params.hasOwnProperty('id') ? params.id : null
    this.peId = null

    // the unique destination identifier (= subdomain)
    this.slug = params.webIdentifier || params.identifier
    this.name = params.name
    this.taxNr = params.taxNr || null
    this.currency = params.currency
    this.street = params.street
    this.zip = params.zip
    this.city = params.city

    // sub destination id of
    this.subDestinationOf = params.hasOwnProperty('subDestinationOf')
      ? params.subDestinationOf
      : null
    this.logo = null
    // only set logo, if any slug is available
    if (this.slug) this.setLogo()

    this.barcodeMode = params.barcode_mode || null
  }

  // set logo
  setLogo() {
    try {
      // allow dynamic file type endings
      const context = require.context(
        '@/assets/destinations/logo/',
        false,
        /\.(png|jpe?g|svg)$/
      )
      const url = context.keys().find((key) => key.includes(this.slug))
      this.logo = context(url)
    } catch (e) {
      this.logo = require('@/assets/destinations/logo/default.png')
    }
  }

  // set destination id of pricing engine. This id may differ from destination id on shop api
  setPeId(id) {
    this.peId = id
  }

  // for example in the basket
  getDefaultProductImage() {
    try {
      return require('@/assets/destinations/defaultProductImage/' +
        this.slug +
        '.jpg')
    } catch (e) {
      return this.logo
    }
  }

  /**
   * ROUTING
   */

  // base url to the api
  getShopApi(withRegion = true, slug = this.slug) {
    if (withRegion) {
      return `${process.env.VUE_APP_SHOP_API_URL}/${slug}/`
    } else return process.env.VUE_APP_SHOP_API_URL
  }

  // base url to the price engine api
  getPeApi(slug = this.slug) {
    if (!slug) {
      return process.env.VUE_APP_PE_API_URL
    }
    return `${process.env.VUE_APP_PE_API_URL}/${slug}/`
  }

  // base url to the price engine api
  getBasePeApi() {
    return process.env.VUE_APP_PE_API_URL
  }

  /**
   * GETTERS
   */

  getId() {
    return this.id
  }

  getSlug() {
    return this.slug
  }

  getSubDestinationOf() {
    return this.subDestinationOf
  }

  isDefaultDestination() {
    return this.slug === 'default'
  }

  getName() {
    return this.name
  }

  getTaxNr() {
    return this.taxNr
  }

  getLogo() {
    return this.logo
  }

  getPeId() {
    return this.peId
  }

  getCurrency() {
    return this.currency
  }

  getAddress() {
    return [this.street, this.zip, this.city].filter(isDefined).join(', ')
  }

  // setters
  setCurrency(value) {
    this.currency = value
  }

  //Api calls
  async updateCurrency(currency) {
    if (currency == null) {
      EventBus.$emit('notify', i18n.t('changeCurrency.currencyNotEmpty'))
      return Promise.resolve([])
    }
    let response

    EventBus.$emit('spinnerShow')
    try {
      response = await shopInstance().put('/region', {
        currency: currency,
      })
    } catch (e) {
      EventBus.$emit('notify', e)
      return Promise.resolve([])
    } finally {
      EventBus.$emit('spinnerHide')
    }

    EventBus.$emit('notify', i18n.t('changeCurrency.changeSuccess'), 'success')
    return Promise.resolve(response)
  }

  getBarcodeMode() {
    return this.barcodeMode
  }
}
