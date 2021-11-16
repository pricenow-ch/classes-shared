import store from '../../store/store'
import ProductDefinition from './ProductDefinition'
import DateHelper from '../utils/DateHelper'
import ProductCapacity from './ProductCapacity'
import { isMoment } from 'moment'
import moment from 'moment'
import definitions from '../../../definitions'
import Events from '../events/Events.js'
import ExtendedAttributes from './ExtendedAttributes'
import Price from './Price'
import { peInstance, shopInstance } from '../utils/axiosInstance'
import BasketConditions from './BasketConditions'
import AvailabilityRanges from '../availabilityRange/AvailabilityRanges'

export default class Product {
  constructor(params) {
    this.id = params.id ? params.id : null
    this.sortOrder = params.hasOwnProperty('sortOrder') ? params.sortOrder : 1
    this.name = params.name ? params.name : null
    this.type = params.type ? params.type : null
    this.destinationId = params.poolId ? params.poolId : null
    this.description = params.description ? params.description : null
    this.createdAt = params.createdAt ? params.createdAt : null
    this.updatedAt = params.updatedAt ? params.updatedAt : null
    this.active = params.active ? params.active : false
    this.productDefinitions = params.productDefinitions
      ? params.productDefinitions
      : []
    this._standardProductDefinitionId =
      params.standardProductDefinitionId || null
    this.icon = params.icon ? params.icon : null
    this.translation = params.translation ? params.translation : null
    this._priceModel = params?.priceModel

    // a person can only be related to one single ticket of this product
    this._oneTicketOnePerson = params.oneTicketOnePerson || null

    // to categorize products (frontend function only)
    this._productCategory = params.productCategory || null

    // Type: ExtendedAttributes.js
    this._extendedAttributes = new ExtendedAttributes(
      params.extendedAttributes,
      'extendedAttributes',
      this.id
    )

    // seasonality + validity dates
    this.availabilityRanges = new AvailabilityRanges().parseApiData(
      params.productAvailabilityRange,
      params.validityDates?.sort()
    )
    /**
     * To what destinations is this product related
     * @requires Array
     * @type Array
     */
    this.destinations = params.destinations ? params.destinations : []
    // capacity management of a product (maximal capacity and bought capacity)
    // only create it, if not existing yet. So we can call this.constructor() without overwriting already loaded capacities
    if (!this.productCapacity) this.productCapacity = null
    // the capacity attribute key, which is defined in the excel importer file
    // should equal productCapacity.getKey() (but theoretically have not to)
    this.capacityAttributeKey = params.capacityAttributeKey || null
    // product id to which the capacities will be transfered
    this.capacityTransferTo = params.capacityTransferTo || null
    // events
    this._events = new Events()
    // lazy load prices
    this.fromDateInstance = null
    this.toDateInstance = null

    this.excludeFromUiFilter = params.excludeFromUiFilter
      ? params.excludeFromUiFilter.split(',')
      : []
    this.basketConditions = params.basketConditions
      ? new BasketConditions(params.basketConditions)
      : new BasketConditions([])
  }

  /**
   * load product data from api
   * @param {number} productId
   * @returns {Promise}
   */
  async loadProduct() {
    if (this.id) {
      /* global EventBus axios */
      EventBus.$emit('spinnerShow')
      try {
        const response = await peInstance().get(`/products/${this.id}`)
        const productData = response.data
        this.constructor(productData)
        if (productData.productDefinitions)
          await this.addProductDefinitions(productData.productDefinitions)
      } catch (e) {
        EventBus.$emit('notify', e.response)
      }
    } else {
      throw new Error('No product id available')
    }

    EventBus.$emit('spinnerHide')
    return Promise.resolve(this)
  }

  /**
   * Only load prices for each product definition, if not done for the whole time span
   * @param fromDateInstance
   * @param toDateInstance
   * @returns {Promise<boolean>}
   */
  async lazyLoadPrices(fromDateInstance, toDateInstance) {
    if (
      !this.fromDateInstance ||
      !this.toDateInstance ||
      fromDateInstance.getTime() < this.fromDateInstance.getTime() ||
      toDateInstance.getTime() > this.toDateInstance.getTime()
    ) {
      // load prices
      await this.loadPrices(fromDateInstance, toDateInstance)
      return Promise.resolve(true)
    }
    return Promise.resolve(false) // the prices in this time span are already loaded. Reload unnecessary
  }

  async loadPrices(fromDateInstance, toDateInstance) {
    try {
      const response = await peInstance().get(`/products/${this.id}/prices`, {
        params: {
          from: DateHelper.shiftLocalToUtcIsoString(fromDateInstance),
          to: DateHelper.shiftLocalToUtcIsoString(toDateInstance),
        },
      })
      const prices = response.data
      const prodDefsIdsAdded = []
      // assign prices to product definitions
      for (let i = 0; i < prices.length; i++) {
        let currentProductDefinitionId = prices[i].productDefinition.id
        let prodDef = this.productDefinitions.find(
          (tmpProdDef) => tmpProdDef.getId() === currentProductDefinitionId
        )
        let price = new Price(prices[i])
        if (!prodDefsIdsAdded.find((id) => id === currentProductDefinitionId)) {
          prodDefsIdsAdded.push(currentProductDefinitionId)
          // reset prices of this product definition
          prodDef.prices = []
        }
        prodDef.prices.push(price)
      }
      this.fromDateInstance = fromDateInstance
      this.toDateInstance = toDateInstance
      return Promise.resolve(true)
    } catch (e) {
      EventBus.$emit('notify', i18n.t('product.pricesCouldNotBeLoaded'))
      return Promise.resolve(false)
    } finally {
      EventBus.$emit('spinnerHide')
    }
  }

  /**
   * CAPACITY MANAGEMENT
   */

  /**
   * load capacity management of this product
   * @from: moment | Date
   * @to: moment | Date
   */
  async fetchCapacities(from, to, force = false, spinner = true) {
    if (!from || !to)
      throw new Error('From or to parameter not set in Product class!')
    if (!isMoment(from) || !isMoment(to)) {
      from = moment(from)
      to = moment(to)
    }

    // only load capacities, if selected range is not loaded yet
    if (this.productCapacity && !force) {
      // we have a capacity
      // are the requested dates already loaded?
      let firstCapacityDate = this.productCapacity.getFirstCapacityDate()
      let lastCapacityDate = this.productCapacity.getLastCapacityDate()

      // return if from and to are already loaded capacities
      if (
        firstCapacityDate &&
        lastCapacityDate &&
        firstCapacityDate.getDate().getTime() <= from.valueOf() &&
        lastCapacityDate.getDate().getTime() >= to.valueOf()
      ) {
        return Promise.resolve(true)
      }
    }

    /* global EventBus axios i18n */
    if (spinner)
      EventBus.$emit('spinnerShow', i18n.t('personAdder.checkForAvailability'))
    try {
      const { data } = await shopInstance().get(
        `/capacity/product/${this.id}`,
        {
          params: {
            from: from.format('YYYY-MM-DD'),
            to: to.format('YYYY-MM-DD'),
          },
        }
      )
      this.productCapacity = new ProductCapacity(data)
      EventBus.$emit('Product:CapacityFetched')
      return Promise.resolve(this.productCapacity)
    } catch (e) {
      EventBus.$emit('notify', i18n.t('notify.errorWhileFetchingCapacities'))
      return Promise.resolve(false)
    } finally {
      if (spinner) EventBus.$emit('spinnerHide')
    }
  }

  /**
   * Checks whether the capacity for a date is ok or not. Returns a boolean.
   * Automatically checks whether the capacity is on product level or on attribute level.
   * @param allowAttributCapacityCrossCheck:
   * @returns Boolean
   */
  isCapacityOk(dateInstance, productDefinition) {
    let productCapacity = this.getProductCapacity()
    if (!productCapacity)
      throw new Error(
        'Product capacity not ready! Fetch it first from the api.'
      )

    // we don't have any capacity constraints
    if (!productCapacity.hasCapacityOfAnyType()) return true

    // 1. check if we have capacity limitations on product level
    let attributeKey = productCapacity.getKey()
    let stockLeft = null
    if (attributeKey === null) {
      stockLeft = productCapacity.getStockLeft(dateInstance)
    } else {
      // 2. we have capacity constraints on attribute level
      let attributeValue = productDefinition.getAttributeValueByKey(
        attributeKey
      )
      if (!attributeValue)
        throw new Error(
          'No attribute value found while calculating capacity in Product.js!'
        )

      // calc stock left for the capacity attribute value
      stockLeft = productCapacity.getStockLeft(dateInstance, attributeValue)
    }

    // no capacity constraints
    if (stockLeft === true) return true

    // health check
    if (stockLeft === null)
      throw new Error('Stock left is null but should be an integer!')

    // consider capacity on product definition level
    stockLeft = stockLeft - productDefinition.getCapacityCount()
    if (stockLeft < 0) return false

    // stock left
    return true
  }

  /**
   * load all events of this product
   * @returns {Promise<unknown>}
   */
  async loadEvents(from, to, showSpinner = true) {
    if (!from || !to)
      throw new Error(
        'From or to parameter missed in loadEvents() of Product.js!'
      )

    /* global EventBus axios store */
    if (showSpinner)
      EventBus.$emit('spinnerShow', i18n.t('product.loadingEvents'))
    try {
      const { data } = await shopInstance().get(
        `/admin/events/${this.id}/${from.format('YYYY-MM-DD')}/${to.format(
          'YYYY-MM-DD'
        )}`
      )

      this.events = new Events(data)
    } catch (e) {
      EventBus.$emit('notify', i18n.t('product.eventsCouldNotBeLoaded'))
    } finally {
      if (showSpinner) EventBus.$emit('spinnerHide')
      return Promise.resolve(this.events)
    }
  }

  /**
   * create ProductDefinition instance for each productDefinition & add it to productDefinitions
   * @param {array} productDefinitions
   * @param {Product} productInstance
   */
  addProductDefinitions(productDefinitions, productInstance) {
    // reset already added product definitions
    this.productDefinitions = []

    productDefinitions.forEach((productDefinition) => {
      productDefinition.destinations = this.destinations
      if (productInstance) {
        productDefinition.productInstance = productInstance
        productDefinition.productId = productInstance.getId()
      }
      this.productDefinitions.push(new ProductDefinition(productDefinition))
    })

    return this.productDefinitions
  }

  async inverseIsActive() {
    /* global EventBus axios store */
    EventBus.$emit('spinnerShow', i18n.t('product.updatingValidityDates'))
    try {
      await peInstance(false).put(`/admin/products/${this.id}`, {
        active: !this.active,
      })
      this.active = !this.active
    } catch (e) {
      EventBus.$emit('notify', i18n.t('singleProductView.errorUpdatingActive'))
    } finally {
      EventBus.$emit('spinnerHide')
    }
    return Promise.resolve(this.active)
  }

  /**
   * GETTERS
   */

  getIcon() {
    return this.icon
  }

  getId() {
    return this.id
  }

  getName() {
    return this.name
  }

  getProductDefinitions() {
    return this.productDefinitions
  }

  getProductDefinitionInstance(productDefinitionId) {
    return this.productDefinitions.find(
      (prodDef) => prodDef.getId() === productDefinitionId
    )
  }

  getExcludesFromUiFilters() {
    return this.excludeFromUiFilter
  }

  getBasketConditions() {
    return this.basketConditions
  }

  /**
   * gets a specific productDefinition by id
   * @param {number} definitionId
   * @returns {array} filteredDefinition
   */
  getProductDefinition(definitionId) {
    let definitions = JSON.parse(JSON.stringify(this.productDefinitions))
    let filteredDefinition = definitions.filter(
      (definition) => definition.id === definitionId
    )[0]
    return filteredDefinition
  }

  getAllAttributeNames(sort = true) {
    const productDefinitions = this.getProductDefinitions()
    const attributesToReturn = []

    // iterate product definitions
    for (let a = 0; a < productDefinitions.length; a++) {
      let attributes = productDefinitions[a].getAttributes()

      // iterate attributes
      for (let attributeKey in attributes) {
        let foundAttributeToReturn = attributesToReturn.find(
          (attributeToReturn) => {
            return attributeToReturn.key === attributeKey
          }
        )

        let attributeValues = []
        attributeValues.push(attributes[attributeKey])

        // did we already added this attribute key ?
        if (
          !foundAttributeToReturn &&
          attributeValues &&
          attributes[attributeKey]
        ) {
          attributesToReturn.push({
            key: attributeKey,
            values: attributeValues,
          })
        }
        // fix 23.03.2020: added && attributes[attributeKey] !== null => https://pricenow.atlassian.net/browse/T1-626
        else if (
          foundAttributeToReturn !== undefined &&
          attributes[attributeKey] !== null
        ) {
          // attribute key already added just push the attribute's values-object
          foundAttributeToReturn.values.push(attributes[attributeKey])
        }
      }
    }

    if (sort) {
      for (let k = 0; k < attributesToReturn.length; k++) {
        attributesToReturn[k].values.sort((a, b) => {
          if (a === null || b === null) return 1 // null values
          return a.sortOrder - b.sortOrder
        })
      }
    }
    return attributesToReturn
  }

  /**
   * getting possible attributes of this products by a particular key
   * @param key
   * @param productDefinitions
   * @param considerMauiOnly
   * @param capacityDateInstance: Consider capacity check
   * @returns Array
   */
  getPossibleAttributeValuesByKey(
    key,
    productDefinitions = this.productDefinitions,
    considerMauiOnly = false,
    capacityDateInstance = null
  ) {
    // consider capacity limitations
    const productCapacity = this.getProductCapacity()
    if (capacityDateInstance && !productCapacity) {
      console.warn('Warning: No product capacity given!')
      return []
    }

    let attributes = []
    // the capacity attribute key may differ from the given key
    const capacityAttributeKey = this.getCapacityAttributeKey()
    // iterate product definitions
    for (let i = 0; i < productDefinitions.length; i++) {
      const productDefinition = productDefinitions[i]
      if (considerMauiOnly && productDefinition.isMauiOnly()) continue
      const currentAttributes = productDefinition.getAttributes()
      // add attribute to attributes, if not yet added
      if (currentAttributes[key]) {
        // check capacity
        const capacityAttributeValue =
          capacityAttributeKey !== null
            ? currentAttributes[capacityAttributeKey].value
            : null

        // note: the getStockLeft() method has to be evaluated after the capacityDateInstance.
        // otherwise the getStockLeft() method doesn't get the required date instance.
        if (
          capacityDateInstance &&
          productCapacity.getStockLeft(
            capacityDateInstance,
            capacityAttributeValue
          ) <= 0
        ) {
          continue
        }

        attributes = this.containsAttribute(attributes, key, currentAttributes)
      }
    }

    // sort the attributes by the sort order
    attributes.sort((attributeA, attributeB) => {
      return (
        attributeA[key][definitions.attributeValues.sortOrder] -
        attributeB[key][definitions.attributeValues.sortOrder]
      )
    })

    return attributes
  }

  // helper function
  containsAttribute(attributes, key, attributesInstance) {
    // iterate attributes
    for (let i = 0; i < attributes.length; i++) {
      let attribute = attributes[i]

      if (
        attribute[key][definitions.attributeValues.value] ===
        attributesInstance[key][definitions.attributeValues.value]
      ) {
        // fix 14.12.2019: check, if sort order of new attributesInstance is lower, than the current found
        // if so: delete existing attribute in attributes array and add the new one
        // why? the performance diff leads to multiple equal values but different sort orders
        if (
          attributesInstance[key][definitions.attributeValues.sortOrder] <
          attribute[key][definitions.attributeValues.sortOrder]
        ) {
          attributes.splice(i, 1)
          attributes.push(attributesInstance)
        }

        return attributes
      }
    }

    attributes.push(attributesInstance)
    return attributes
  }

  /**
   * Filter all product definitions by attribute pairs and then filter it by an attribute key
   * @param key
   * @param attributePairs
   * @returns {Promise<*[]>}
   */
  async getPossibleAttributesByKeyAndAttributePairs(key, attributePairs) {
    let possibleProductDefinitions = await this.filterProductDefinitionsByAttributes(
      attributePairs,
      false
    )
    return await this.getPossibleAttributeValuesByKey(
      key,
      possibleProductDefinitions
    )
  }

  /**
   * get all attributes of this product => used for the filters
   * @param {object} filters
   * @returns {Promise<string>}
   */
  filterProductByAttributesAndDestinations(filters) {
    // deep clone product definitions
    let filteredDefinitions = []

    // iterate prod defs
    for (let a = 0; a < this.productDefinitions.length; a++) {
      filteredDefinitions.push(
        Object.assign(
          Object.create(this.productDefinitions[a]),
          this.productDefinitions[a]
        )
      )
    }

    // let filteredDefinitions = JSON.parse(JSON.stringify(this.productDefinitions)) // Object.assign(Object.create(this.productDefinitions), this.productDefinitions)
    let attributeNames = Object.keys(filters)

    // iterate filters
    for (let attributeName of attributeNames) {
      // filter for destination
      if (attributeName === 'destinations') {
        // iterate product definitions
        filteredDefinitions = filteredDefinitions.filter(
          (productDefinition) => {
            let destinationsToFilter = filters[attributeName]

            // iterate destinations of the current product definition
            for (let i = 0; i < productDefinition.destinations.length; i++) {
              let destination = productDefinition.destinations[i]
              if (destinationsToFilter.includes(destination.id)) return true
              else return false
            }
          }
        )
      } else {
        // filter for attributes
        filteredDefinitions = filteredDefinitions.filter(
          (productDefinition) => {
            let included = filters[attributeName].find((elem) => {
              return elem === productDefinition.attributes[attributeName]?.value
            })

            // on purpose ;) since it can happen that included = false
            if (included === undefined) return false
            else return true
          }
        )
      }
    }

    return filteredDefinitions
  }

  filterByProdDefIds(ids) {
    // deep clone product definitions
    let filteredDefinitions = []

    // iterate prod defs
    for (let a = 0; a < this.productDefinitions.length; a++) {
      filteredDefinitions.push(
        Object.assign(
          Object.create(this.productDefinitions[a]),
          this.productDefinitions[a]
        )
      )
    }

    return filteredDefinitions.filter((prodDef) => {
      return ids.includes(prodDef.getId())
    })
  }

  /**
   * GETTERS
   */

  /**
   * filter for all product definitions containing a certain attribute
   * @param key
   * @returns {Array}
   */
  getProductDefinitionsContainingAttributeKey(key) {
    let productDefinitions = []

    // iterate product definitions
    for (let i = 0; i < this.productDefinitions.length; i++) {
      let productDefinition = this.productDefinitions[i]

      // if product definition contains key, add it
      if (productDefinition.hasAttribute(key)) {
        productDefinitions.push(productDefinition)
      }
    }

    return productDefinitions
  }

  /**
   * get an array of product definitions, which are the same as the passed product definition but are different from the passed attribute key
   * useful for the calendar dropdown
   * @param attributeKey
   * @param productDefinition
   * @param excludeAttributeKeys
   */
  filterProductDefinitionsByProductDefinitionAndAttributeKey(
    attributeKey,
    productDefinition,
    excludeAttributeKeys = [],
    includeMauiOnly = false
  ) {
    let filteredProductDefinitions = []

    const attributesInstance = productDefinition.getAttributes()
    const requiredAttributeKeys = this.getRequiredAttributes(
      attributesInstance,
      [attributeKey, ...excludeAttributeKeys]
    )

    // iterate product definitions
    for (let a = 0; a < this.productDefinitions.length; a++) {
      const currentProductDefinition = this.productDefinitions[a]

      let containsAllRequiredKeys = true
      // iterate all required attribute keys
      for (let i = 0; i < requiredAttributeKeys.length; i++) {
        const attributeKey = requiredAttributeKeys[i]

        // check the attribute values equals the standard attributes instance
        if (
          !currentProductDefinition.getAttributes()[attributeKey] ||
          !attributesInstance[attributeKey] ||
          currentProductDefinition.getAttributes()[attributeKey][
            definitions.attributeValues.value
          ] !==
            attributesInstance[attributeKey][definitions.attributeValues.value]
        ) {
          containsAllRequiredKeys = false
          break // performance!
        }
      }

      if (containsAllRequiredKeys)
        filteredProductDefinitions.push(currentProductDefinition)
    }
    // remove maui (mitarbeiter-ui) only product definitions
    filteredProductDefinitions = filteredProductDefinitions.filter(
      (productDefinition) => !productDefinition.isMauiOnly()
    )

    if (!includeMauiOnly) {
      filteredProductDefinitions = filteredProductDefinitions.filter(
        (prodDef) => !prodDef.isMauiOnly()
      )
    }

    // sort filtered product definitions
    return filteredProductDefinitions.sort(
      (productDefinitionA, productDefinitionB) => {
        return (
          productDefinitionA.getAttributes()[attributeKey][
            definitions.attributeValues.sortOrder
          ] -
          productDefinitionB.getAttributes()[attributeKey][
            definitions.attributeValues.sortOrder
          ]
        )
      }
    )
  }

  /**
   * search for a new product definition, which is almost the same as the original product definition but has one
   * attribute with a changed attribute value
   * @param originalProductDefinition
   * @param excludeAttributeKeys
   * @param valueKey: if you want to exchange another value key than 'value'. For example 'peopleCount'
   * @param attributePairs: Array with attribute key and value
   * @param includeMauiOnly
   * @returns {Promise<ProductDefinition | null>}
   */
  exchangeProductDefinitionWithAttribute(
    originalProductDefinition,
    attributePairs,
    excludeAttributeKeys = [],
    valueKey = definitions.attributeValues.value,
    includeMauiOnly = false
  ) {
    const originalAttributesInstance = originalProductDefinition.getAttributes()

    // 1.) try without attribute exclusion
    let requiredAttributes = this.getRequiredAttributes(
      originalAttributesInstance
    )
    let foundProductDefinition = this.searchForProductDefinition(
      requiredAttributes,
      attributePairs,
      originalAttributesInstance,
      valueKey,
      includeMauiOnly
    )

    if (!foundProductDefinition && excludeAttributeKeys.length) {
      // 2.) try with attribute exclusion
      requiredAttributes = this.getRequiredAttributes(
        originalAttributesInstance,
        excludeAttributeKeys
      )
      foundProductDefinition = this.searchForProductDefinition(
        requiredAttributes,
        attributePairs,
        originalAttributesInstance,
        valueKey,
        includeMauiOnly
      )
    } else return foundProductDefinition // we got an exchanged product definition

    return foundProductDefinition
  }

  // helper method for exchangeProductDefinitionWithAttribute
  searchForProductDefinition(
    requiredAttributes,
    attributePairs,
    originalAttributesInstance,
    valueKey,
    includeMauiOnly
  ) {
    // iterate product definitions
    for (let a = 0; a < this.productDefinitions.length; a++) {
      const currentProductDefinition = this.productDefinitions[a]

      if (!includeMauiOnly && currentProductDefinition.isMauiOnly()) continue

      let newProductDefinition = currentProductDefinition

      // iterate required attributes
      for (let i = 0; i < requiredAttributes.length; i++) {
        let currentRequiredAttributeKey = requiredAttributes[i]

        // check for the new attribute value
        let attributePair = attributePairs.find((pair) => {
          return pair.key === currentRequiredAttributeKey
        })

        if (attributePair) {
          // consider null values from importer
          const attributeValue = currentProductDefinition.getAttributes()[
            currentRequiredAttributeKey
          ][valueKey]
          if (
            attributeValue !== null &&
            attributeValue !== attributePair[valueKey]
          ) {
            newProductDefinition = null
            break
          }
        } else {
          // check original attribute value
          // consider null values from importer
          const attribute = currentProductDefinition.getAttributes()[
            currentRequiredAttributeKey
          ]
          if (
            attribute !== null &&
            attribute[definitions.attributeValues.value] !==
              originalAttributesInstance[currentRequiredAttributeKey][
                definitions.attributeValues.value
              ]
          ) {
            newProductDefinition = null
            break
          }
        }
      }

      if (newProductDefinition) return newProductDefinition
    }

    return null
  }

  /**
   * get first product defintions by multiple attribute pairs (key/value-pairs)
   * @returns Array | ProductDefinition
   **/
  filterProductDefinitionsByAttributes(
    attributePairs,
    returnOnFirstProductDefinition = false,
    includeMauiOnly = false
  ) {
    // iterate product definitions
    let productDefinitions = []
    for (let i = 0; i < this.productDefinitions.length; i++) {
      let productDefinition = this.productDefinitions[i]

      // do not consider maui only products
      if (!includeMauiOnly && productDefinition.isMauiOnly()) continue

      let allAttributePairsFit = true

      // iterate attribute pairs
      for (let b = 0; b < attributePairs.length; b++) {
        let attributePair = attributePairs[b]
        let foundAttributeValue = productDefinition.getAttributeValueByKey(
          attributePair.key
        )

        // consider null values from importer
        if (
          foundAttributeValue !== null &&
          foundAttributeValue !== attributePair.value
        ) {
          allAttributePairsFit = false
          break
        }
      }

      // prod def has been found
      if (returnOnFirstProductDefinition && allAttributePairsFit)
        return productDefinition
      if (!returnOnFirstProductDefinition && allAttributePairsFit)
        productDefinitions.push(productDefinition)
    }

    if (returnOnFirstProductDefinition && !productDefinitions.length)
      return null
    return productDefinitions
  }

  /**
   * helper method
   * @param attributesInstance
   * @param attributesToExclude
   * @returns [AttributeKeyString]
   */
  getRequiredAttributes(attributesInstance, attributesToExclude = []) {
    let requiredAttributes = []

    // iterate original product definition to get all required attribute keys
    for (let attributeKey in attributesInstance) {
      // skip not available attribute
      if (!attributesInstance[attributeKey]) continue
      const excludeThisAttribute =
        attributesToExclude.length && attributesToExclude.includes(attributeKey)
      if (excludeThisAttribute) continue
      requiredAttributes.push(attributeKey)
    }
    // returns an array with attribute keys:string
    return requiredAttributes
  }

  getAvailabilityDateRanges() {
    return this.availabilityRanges
  }

  /**
   * returns an array with all available dates depending on the "availability ranges" and the "validity dates"
   * available types: 'date', 'moment', 'dateString' (YYYY-MM-DD)
   */
  getAvailableDates(type = 'date') {
    return this.getAvailabilityDateRanges().getDateList(type)
  }

  /**
   * Checks, if a product definition of this product has the full time span within validity dates and availability ranges
   * @param productDefinitionInstance
   * @param bookingStartInstance
   * @return {boolean}
   */
  checkAvailableDates(productDefinitionInstance, bookingStartInstance) {
    // get an list of available dates of the product
    const availableDateList = this.getAvailableDates('date')
    // get a list of dates of the product definition (booking date + duration days)
    const durationDays = productDefinitionInstance.getDurationDays()
    const endDate = new Date(
      bookingStartInstance.getFullYear(),
      bookingStartInstance.getMonth(),
      bookingStartInstance.getDate() + durationDays - 1,
      0,
      0,
      0,
      0
    )
    const bookingDateList = DateHelper.getDateList(
      bookingStartInstance,
      endDate
    )
    for (let i = 0; i < bookingDateList.length; i++) {
      const bookingDate = bookingDateList[i]
      const foundAvailableDate = availableDateList.find((availableDate) => {
        return availableDate.getTime() === bookingDate.getTime()
      })
      if (!foundAvailableDate) {
        EventBus.$emit('notify', i18n.t('basket.dateNotAvailable'))
        return false
      }
    }
    return true
  }

  getCurrentSeasonStart() {
    const availableDates = this.getAvailableDates()
    const todayMs = new Date().setHours(0, 0, 0, 0)
    return availableDates.find((availableDate) => {
      const availableDateMs = availableDate.setHours(0, 0, 0, 0)
      if (availableDateMs >= todayMs) {
        return true
      }
    })
  }

  // get last available bookable date of this product
  getCurrentSeasonEnd() {
    const dateList = this.getAvailableDates()
    return dateList[dateList.length - 1]
  }

  /**
   * get the next possible date, a user can book
   * takes capacities and season dates in account as well as latest booking time constraints and validity dates
   * it's a recursive function!
   * capacityStartDate never changes
   * you can ignore latest booking time constraints eg. for admins
   * @param nextDate
   * @param capacityEndDate
   * @param notify
   * @param capacityStartDate
   * @param ignoreLatestBookingTime
   * @param ignoreCapacity
   * @param productDefinition
   * @param checkCapacityOverAllProductDefinitions: Only one product definition has to pass the capacity check.
   * Useful, when checking all product definitions. Used in the ShopOverview.vue
   * @return {Promise<null|*|moment.Moment>}
   */
  async getNextPossibleBookingDate(
    nextDate = null,
    capacityEndDate = null,
    notify = true,
    ignoreLatestBookingTime = false,
    ignoreCapacity = false,
    productDefinition = this.getStandardProductDefinition(),
    checkCapacityOverAllProductDefinitions = false
  ) {
    if (!nextDate) {
      // function initially called
      nextDate = moment(this.getCurrentSeasonStart())
    } else {
      // check, if next date is inside season boundaries
      if (
        nextDate.valueOf() < this.getCurrentSeasonStart().getTime() ||
        nextDate.valueOf() > this.getCurrentSeasonEnd().getTime()
      ) {
        nextDate = moment(this.getCurrentSeasonStart())
      }
    }

    const availableDates = this.getAvailableDates()
    const isNextDateOutOfSeason = !availableDates.find((availableDate) => {
      if (availableDate.getTime() === nextDate.valueOf()) return true
    })
    if (isNextDateOutOfSeason) {
      return null
    }

    // 2.) is latest booking time constraint full filled?
    let nextDateFromList = this.getNextDateFromList(
      nextDate.toDate(),
      availableDates
    )
    if (!nextDateFromList) return null
    nextDateFromList = moment(nextDateFromList)
    if (
      !ignoreLatestBookingTime &&
      !(await productDefinition.isLatestBookingTimeOk(nextDate.toDate(), false))
    ) {
      // avoid endless loop
      if (availableDates.length === 1) return null
      return await this.getNextPossibleBookingDate(
        nextDateFromList,
        capacityEndDate,
        notify,
        ignoreLatestBookingTime,
        ignoreCapacity,
        productDefinition,
        checkCapacityOverAllProductDefinitions
      )
    }

    if (ignoreCapacity) return nextDate
    // 3.) check capacities
    // set capacity end date if capacityEndDate is null (not passed as argument) or smaller than the nextDate variable
    if (!capacityEndDate || capacityEndDate.valueOf() < nextDate.valueOf()) {
      capacityEndDate = moment(nextDate).add(30, 'd')
    }
    // lazy load capacities
    let response = await this.fetchCapacities(nextDate, capacityEndDate)
    if (!response) return null
    // check capacity
    if (checkCapacityOverAllProductDefinitions) {
      // if at least one product definition is available, return the next date
      for (let b = 0; b < this.productDefinitions.length; b++) {
        let iterateProductDefinition = this.productDefinitions[b]
        if (this.isCapacityOk(nextDate.toDate(), iterateProductDefinition))
          return nextDate
      }
    } else {
      // only check a specific product definition
      if (this.isCapacityOk(nextDate.toDate(), productDefinition))
        return nextDate // next date found
    }
    // avoid endless loop
    if (availableDates.length === 1) return null
    // capacity is not ok => re-call method
    return await this.getNextPossibleBookingDate(
      nextDateFromList,
      capacityEndDate,
      notify,
      ignoreLatestBookingTime,
      ignoreCapacity,
      productDefinition,
      checkCapacityOverAllProductDefinitions
    )
  }

  /**
   * helper function to get the next date of available dates
   * @param dateInstance
   * @param availableDates
   * @returns {null|*}
   */
  getNextDateFromList(dateInstance, availableDates = this.getAvailableDates()) {
    if (availableDates.length === 1) return availableDates[0]
    return availableDates.find((availableDate) => {
      return availableDate.getTime() > dateInstance.getTime()
    })
  }

  /**
   * does this product contain the product definition id passed as param?
   * @param productDefinitionId
   * @returns {boolean}
   */
  includeProductDefinitionId(productDefinitionId) {
    // iterate product definitions
    for (let i = 0; i < this.productDefinitions.length; i++) {
      if (this.productDefinitions[i].getId() === productDefinitionId)
        return true
    }

    return false
  }

  /**
   * TRANSLATIONS AND PRODUCT DESCRIPTION METHODS
   */

  // simple pe translation string
  getTranslation() {
    return this.translation
  }

  // fallback order: ExtendedAttributes.js(EntityTranslations.title) => extTrans.translation
  getTitle() {
    const currentLanguageTranslationOrFallback = this.getCurrentLanguageTranslationOrFallback()
    const exTransLoaded = store.getters.getExtTransLoaded()
    return currentLanguageTranslationOrFallback &&
      currentLanguageTranslationOrFallback.title
      ? currentLanguageTranslationOrFallback.title
      : i18n.t(this.getTranslation())
  }

  // alias for getMediumText()
  getDescription() {
    return this.getMediumText()
  }

  getMediumText() {
    let currentLanguageTranslationOrFallback = this.getCurrentLanguageTranslationOrFallback()
    return currentLanguageTranslationOrFallback
      ? currentLanguageTranslationOrFallback.mediumText
      : ''
  }

  getLongText() {
    let currentLanguageTranslationOrFallback = this.getCurrentLanguageTranslationOrFallback()
    return currentLanguageTranslationOrFallback
      ? currentLanguageTranslationOrFallback.longText
      : ''
  }

  getIcons(key = null, value = null) {
    let currentLanguageTranslationOrFallback = this.getCurrentLanguageTranslationOrFallback(
      key,
      value
    )
    return currentLanguageTranslationOrFallback
      ? currentLanguageTranslationOrFallback.icons
      : []
  }

  // get the title of attribute level
  getAttributeTitle(key, value) {
    let translation = this.getCurrentLanguageTranslationOrFallback(key, value)
    return translation ? translation.title : null
  }

  getAttributeMediumText(key, value) {
    let translation = this.getCurrentLanguageTranslationOrFallback(key, value)
    return translation ? translation.mediumText : null
  }

  getAttributeLongText(key, value) {
    let translation = this.getCurrentLanguageTranslationOrFallback(key, value)
    return translation ? translation.longText : null
  }

  getCurrentLanguageTranslationOrFallback(key = null, value = null) {
    // also consider an event
    let currentEvent = this.getCurrentEvent()
    if (currentEvent) return currentEvent

    let extendedAttribute = this.getExtendedAttribute(key, value)
    if (extendedAttribute)
      return extendedAttribute.getCurrentLanguageTranslationOrFallback()
    return null
  }

  getCurrentEvent() {
    if (this.events.events.length)
      return this.events.events.find(
        (event) => event.id === this.getCurrentEventId()
      )
    return null
  }

  getCurrentEventId() {
    // backend frontends don't own shop modules nor the related functions in the store. check and skip.
    if (typeof store.getters.getActiveModuleInstance === 'function') {
      return store.getters.getActiveModuleInstance()?.getCurrentEventId()
    }
    return null
  }

  // EXTENDED ATTRIBUTES SHORT CUTS
  getExtendedAttribute(key = null, value = null) {
    let extendedAttributesArray = this.extendedAttributes.getExtendedAttributeByValueAndKey(
      value,
      key
    )
    if (extendedAttributesArray.length > 0) return extendedAttributesArray[0]
    return null
  }

  // short cut to get the first image
  getFirstImageSrc(key = null, value = null) {
    // consider an event
    let currentEvent = this.getCurrentEvent()
    if (currentEvent) return currentEvent.getFirstImageSrc()

    let extendedAttribute = this.getExtendedAttribute(key, value)
    if (extendedAttribute) return extendedAttribute.getFirstImageSrc()
    // try to get default product image
    return store.getters.getAppDestinationInstance().getDefaultProductImage()
  }

  getAllImageSrc(key = null, value = null) {
    let extendedAttribute = this.getExtendedAttribute(key, value)
    if (extendedAttribute) return extendedAttribute.getAllImageSrc()
    return ''
  }

  getTimeFrom() {
    // consider event
    let currentEvent = this.getCurrentEvent()
    if (currentEvent) return currentEvent.startTime

    // consider extended attributes
    let extendedAttribute = this.getExtendedAttribute()
    if (extendedAttribute) return extendedAttribute.getStartTime()
  }

  getTimeTo() {
    // consider event
    let currentEvent = this.getCurrentEvent()
    if (currentEvent) return currentEvent.endTime

    // consider extended attributes
    let extendedAttribute = this.getExtendedAttribute()
    if (extendedAttribute) return extendedAttribute.getEndTime()
  }

  // e.g. train, ski, hotel
  getType() {
    return this.type
  }

  getProductCapacity() {
    if (this.productCapacity) return this.productCapacity
    return null
  }

  setProductCapacity(productCapacity) {
    this.productCapacity = productCapacity
  }

  // an event template is characterized through the products name, which has to start with "event"
  isEventTemplate() {
    return this.name && this.name.startsWith('event')
  }

  isRequest() {
    return this.name && this.name.startsWith('request')
  }

  isRequired() {
    return this.name && this.name.startsWith('required')
  }

  isReservation() {
    return this.name?.startsWith('reservation')
  }

  isFee() {
    return this.type.startsWith('fee')
  }

  isActive() {
    return this.active
  }

  /**
   * @returns {ProductDefinition}
   */
  getStandardProductDefinition() {
    return this.productDefinitions.find(
      (productDefinition) =>
        productDefinition.id === this.standardProductDefinitionId
    )
  }

  getProductCategoryTitle() {
    if (!this.productCategory) return false
    return i18n.t('productCategories.' + this.productCategory)
  }

  getCapacityAttributeKey() {
    return this.capacityAttributeKey
  }

  getSortOrder() {
    return this.sortOrder
  }

  getCapacityTransferTo() {
    return this.capacityTransferTo
  }

  setId(id) {
    this.id = id
  }

  get events() {
    return this._events
  }

  set events(value) {
    this._events = value
  }

  get extendedAttributes() {
    return this._extendedAttributes
  }

  set extendedAttributes(value) {
    this._extendedAttributes = value
  }

  get standardProductDefinitionId() {
    return this._standardProductDefinitionId
  }

  set standardProductDefinitionId(value) {
    this._standardProductDefinitionId = value
  }

  get oneTicketOnePerson() {
    return this._oneTicketOnePerson
  }

  set oneTicketOnePerson(value) {
    this._oneTicketOnePerson = value
  }

  get productCategory() {
    return this._productCategory
  }

  set productCategory(value) {
    this._productCategory = value
  }

  get priceModel() {
    return this._priceModel
  }

  set priceModel(value) {
    this._priceModel = value
  }

  // set a new array with validity dates from api
  setValidityDates(validityDates) {
    this.availabilityRanges.setValidityDates(validityDates)
  }
}
