import DateHelper from '../utils/DateHelper'
import ProductDefinition from '../products/ProductDefinition'
import BasketEntry from './BasketEntry'
import UserData from './UserData'
import Vouchers from '../vouchers/Vouchers'
import Vats from '../vats/Vats'
import _ from 'lodash'
import { peInstance } from '../utils/axiosInstance'
import BasketConditions from '../products/BasketConditions'
import PromoCodes from '../PromoCodes/PromoCodes'

export default class Basket {
  constructor() {
    this.uuid = null
    this.validUntil = null
    this.basketEntries = []
    this.askuserForDiscount = []

    // money
    this.discounts = []
    this.priceGross = null
    this.priceNet = null
    this.vatsInstance = new Vats()

    // Vouchers instance
    this.vouchersInstance = new Vouchers()
    // Promo Codes
    this.promoCodes = new PromoCodes()
    // user comment
    this.comment = null
    // co2 compensation: cause we care
    this.causeWeCare = null
    // amount of co2 compensation
    this.cwc = null
    // will be configured after createBasket => the initial value defines the general setting!
    this.causeWeCareActiveInDestination = false
    // for which basket entry the swisspass was selected
    // https://pricenow.atlassian.net/jira/software/projects/T1/boards/4?assignee=5a6895ac30bd892219d501cd&selectedIssue=T1-401
    // also for tarif reduction like in Bellwald eg. local or guestCard
    // structure is {swisspass: [basketEntryId, basketEntryId], tarif: [basketEntryId, basketEntryId]}
    this.basketEntriesForReduction = {}
  }

  // api communication
  async createBasket(isAdminBasket = false) {
    /* global axios store */
    try {
      const response = await peInstance().post('/baskets')
      await this.parseApiData(response.data)

      // save basket in cookies if not admin
      if (!isAdminBasket) {
        EventBus.$emit('changed:basketUuid', this.uuid)
      }

      this.causeWeCareActiveInDestination = this.causeWeCare
    } catch (e) {
      EventBus.$emit('notify', i18n.t('v5.basketUpdateNotSuccessfull'))
    } finally {
      return Promise
    }
  }

  async loadBasket(uuid) {
    /* global axios store */
    try {
      const response = await peInstance().get(`/baskets/${uuid}`)
      await this.parseApiData(response.data)

      this.causeWeCareActiveInDestination = this.causeWeCare
    } catch (e) {
      EventBus.$emit('notify', i18n.t('v5.basketUpdateNotSuccessfull'))
    } finally {
      return Promise
    }
  }

  /**
   * Add multiple ProductDefinitions at once (without preparing the payload)
   * @param amountOfProductDefintions: Number => How many times the product definition should be added
   * @param productDefinition: ProductDefinition[]
   * @param startDateInstance: Date
   * @param userData: UserData
   */
  async addProductDefinitionsToBasket(
    amountOfProductDefintions,
    productDefinition,
    startDateInstance,
    userData,
    isAdminBasket = false
  ) {
    // prepare payload
    let payload = []
    for (let i = 0; i < amountOfProductDefintions; i++) {
      payload.push({
        productDefinitionId: productDefinition.getId(),
        validFrom: DateHelper.shiftLocalToUtcIsoString(startDateInstance),
        userData: userData,
      })
    }
    return await this.addProductDefinitionsPrepared(payload, isAdminBasket)
  }

  /**
   * Add multiple product definitions with prepared payload.
   * Data structure for the payload: {productDefinitionId, validFrom, userData}
   * @param payload
   * @returns {Promise<boolean>}
   */
  async addProductDefinitionsPrepared(payload, isAdminBasket = false) {
    /* global EventBus axios store */
    EventBus.$emit('spinnerShow')
    // check for api basket first
    if (!this.uuid) await this.createBasket(isAdminBasket)
    try {
      const response = await peInstance().post(
        `/baskets/${this.uuid}/entries`,
        payload
      )
      await this.parseApiData(response.data)
      return Promise.resolve(true)
    } catch (e) {
      EventBus.$emit('notify', i18n.t('v5.basketUpdateNotSuccessfull'))
      return Promise.resolve(false)
    } finally {
      EventBus.$emit('spinnerHide')
    }
  }

  /**
   * add product definition to the basket
   * @returns {Promise<boolean>}
   * @param definition
   * @param startDateInstance
   * @param userData
   * @param emitBasketUpdate
   * @param updateCurrentUrlQuery
   */
  async addDefinitionToBasket(
    definition,
    startDateInstance = null,
    userData = null,
    emitBasketUpdate = true,
    updateCurrentUrlQuery = true
  ) {
    /* global EventBus axios store */
    EventBus.$emit('spinnerShow')

    // check for api basket first
    if (!this.uuid) await this.createBasket()

    // load default start date instance
    if (!startDateInstance) startDateInstance = this.getCurrentDateInstance()

    // check that selected date and timespan is within available dates
    const tmpBasketEntry = new BasketEntry({})
    tmpBasketEntry.setValidFrom(startDateInstance)
    tmpBasketEntry.setProductDefinitionInstance(definition)
    const checkResult = this.checkAvailableDates([tmpBasketEntry])
    if (!checkResult) {
      EventBus.$emit('spinnerHide')
      return false
    }

    // set standard user data
    if (!userData) {
      userData = new UserData({
        media: definition.getAvailableMedias()[0],
      })
    }

    try {
      const response = await peInstance().post(
        `/baskets/${this.uuid}/entries`,
        {
          productDefinitionId: definition.getId(),
          validFrom: DateHelper.shiftLocalToUtcIsoString(startDateInstance),
          userData: userData,
        }
      )

      await this.parseApiData(response.data, updateCurrentUrlQuery)
      EventBus.$emit('spinnerHide')
      if (emitBasketUpdate) EventBus.$emit('Basket:updated')
      return true
    } catch (e) {
      EventBus.$emit('notify', i18n.t('v5.basketUpdateNotSuccessfull'))
      EventBus.$emit('spinnerHide')
      return false
    }
  }

  /**
   * delete basket entry and update basket with new date returned from api
   * @param basketEntryId
   * @returns {Promise<PromiseConstructor>}
   */
  async deleteBasketEntry(basketEntryId) {
    /* global EventBus axios */
    EventBus.$emit('spinnerShow')

    try {
      const response = await peInstance().delete(
        `/baskets/${this.uuid}/entries/${basketEntryId}`
      )

      // update basket instance
      await this.parseApiData(response.data)
      EventBus.$emit('Basket:updated')
    } catch (e) {
      const status = e.response.status
      // required basket entry cannot be deleted
      if (status === 404)
        EventBus.$emit('notify', i18n.t('basket.requiredEntryCannotBeDeleted'))
      else EventBus.$emit('notify', i18n.t('v5.basketUpdateNotSuccessfull'))
    } finally {
      EventBus.$emit('spinnerHide')
      return Promise
    }
  }

  /**
   * Simply update an array of BasketEntries (instances)
   * @param basketEntriesArray: BasketEntries[]
   * @returns {Promise<boolean>}
   */
  async updateBasketEntries(basketEntriesArray) {
    // check validity dates
    const checkResult = this.checkAvailableDates(basketEntriesArray)
    if (!checkResult) {
      EventBus.$emit('spinnerHide')
      return false
    }

    // prepare basket entries for the api
    const preparedBasketEntries = basketEntriesArray.map((basketEntry) => {
      basketEntry.getUserData().setCompleteForCheckout(basketEntry)
      return {
        id: basketEntry.getId(),
        productDefinitionId: basketEntry.getProductDefinitionId(),
        validFrom: DateHelper.shiftLocalToUtcIsoString(
          basketEntry.getValidFrom()
        ),
        userData: basketEntry.getUserData(),
      }
    })

    try {
      const response = await peInstance().put(
        `/baskets/${this.uuid}/entries/`,
        preparedBasketEntries
      )
      await this.parseApiData(response.data)
      return Promise.resolve(true)
    } catch (e) {
      EventBus.$emit('notify', i18n.t('v5.basketUpdateNotSuccessfull'))
      return Promise.resolve(false)
    }
  }

  /**
   * changes all basket entries with a particular source state to the passed target state
   * @param sourceState
   * @param targetState
   * @returns {Promise<void>}
   */
  async updateBookingStates(sourceState, targetState) {
    // get all basket entries in the source state
    let basketEntriesToChange = await this.getBasketEntriesInState(sourceState)
    const currentModuleId = store.getters.getActiveModuleInstance().getId()
    basketEntriesToChange = basketEntriesToChange.filter(
      (basketEntry) =>
        basketEntry.getUserData().getOwnedByModuleId() === currentModuleId
    )

    // iterate all basket entries, which have to change
    for (let i = 0; i < basketEntriesToChange.length; i++) {
      let basketEntry = basketEntriesToChange[i]
      basketEntry.setBookingState(targetState)
    }
    // save it to the api
    await this.updateBasketEntries(basketEntriesToChange)
    return Promise.resolve(true)
  }

  /**
   * helper method to update basket entry individually
   * @returns {Promise<null|any>}
   * @param basketEntryInstance
   * @param showSpinner
   * @param updateCurrentUrlQuery
   */
  async updateBasketEntry(
    basketEntryInstance,
    showSpinner = true,
    updateCurrentUrlQuery = true
  ) {
    // check params
    if (
      basketEntryInstance &&
      basketEntryInstance.getProductDefinitionInstance()
    ) {
      if (showSpinner) EventBus.$emit('spinnerShow')

      // check that selected date and timespan is within available dates
      const checkResult = this.checkAvailableDates([basketEntryInstance])
      if (!checkResult) {
        EventBus.$emit('spinnerHide')
        return false
      }

      // is the basket entry ready to be complete for checkout ?
      basketEntryInstance
        .getUserData()
        .setCompleteForCheckout(basketEntryInstance)
      try {
        const response = await peInstance().put(
          `/baskets/${this.uuid}/entries/${basketEntryInstance.getId()}`,
          {
            productDefinitionId: basketEntryInstance.getProductDefinitionId(),
            validFrom: DateHelper.shiftLocalToUtcIsoString(
              basketEntryInstance.getValidFrom()
            ),
            userData: basketEntryInstance.getUserData(),
          }
        )
        await this.parseApiData(response.data, updateCurrentUrlQuery)
      } catch (e) {
        EventBus.$emit('notify', i18n.t('v5.basketUpdateNotSuccessfull'))
      } finally {
        EventBus.$emit('spinnerHide')
        return Promise
      }
    } else {
      return Promise
    }
  }

  /**
   * confirm or deny requested discount
   * @param answer
   * @returns {Promise<boolean>}
   */
  async answerDiscountRequest(answer) {
    /* global EventBus axios store */
    EventBus.$emit('spinnerShow')

    try {
      const response = await peInstance().put(
        `/baskets/${this.uuid}/discounts/${this.askuserForDiscount[0].id}`,
        {
          status: answer,
        }
      )

      await this.parseApiData(response.data)
    } catch (e) {
      EventBus.$emit('notify', e.response)
    } finally {
      EventBus.$emit('spinnerHide')
      return Promise
    }
  }

  /**
   * Try to add a promo code
   * @param code
   * @returns {Promise<Basket|boolean>}
   */
  async addPromoCode(code) {
    try {
      const response = await peInstance().put(
        `/baskets/${this.uuid}/promo_code`,
        {
          promo_code: code,
        }
      )
      await this.parseApiData(response.data)
      return this
    } catch (e) {
      return false
    }
  }
  async removePromoCode(code) {
    try {
      const response = await peInstance().delete(
        `/baskets/${this.uuid}/promo_code/${code}`
      )
      await this.parseApiData(response.data)
      return this
    } catch (e) {
      return false
    }
  }

  /**
   * create basket entry instances out of raw api data
   * @param basket
   * @param updateCurrentUrlQuery
   */
  async parseApiData(basket, updateCurrentUrlQuery = true) {
    this.uuid = basket.uuid ? basket.uuid : null
    this.validUntil = basket.validUntil ? basket.validUntil : null
    this.discounts = basket.discounts ? basket.discounts : []
    this.priceGross =
      basket.price && basket.price.gross ? basket.price.gross : null
    this.priceNet = basket.price && basket.price.net ? basket.price.net : null
    if (basket.vatRates && basket.vatRates.length) {
      this.vatsInstance = new Vats(basket.vatRates)
    } else {
      // reset vats
      this.vatsInstance = new Vats()
    }
    this.askuserForDiscount = basket.askUserForDiscount
      ? basket.askUserForDiscount
      : []
    this.causeWeCare = basket.causeWeCare
    this.cwc = basket.cwc
    // because of Vue's reactivity caveat
    this.promoCodes = this.promoCodes.parseApiData(basket.promoCodes)

    // ask user for discount
    if (this.askuserForDiscount.length)
      EventBus.$emit('Basket:askUserForDiscount', this.askuserForDiscount[0])

    // parse basket entries, if any
    if (basket.hasOwnProperty('basketEntries')) {
      // reset basket entries
      this.basketEntries = []
      const entries = basket.basketEntries
      // sort Entries so the newest comes first.
      entries.sort((firstEntry, secondEntry) => secondEntry.id - firstEntry.id)
      let currentVarsSet = false

      // iterate basket entries
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        // create product definition instance
        entry.productDefinitionInstance = new ProductDefinition(
          entry.productDefinition
        )

        // create basket entry instance
        const tmpBasketEntry = new BasketEntry(entry)
        this.basketEntries.push(tmpBasketEntry)

        // handle url navigation
        if (updateCurrentUrlQuery && !currentVarsSet) {
          currentVarsSet = await this.setCurrentUrlQuery(tmpBasketEntry)
        }
      }

      // sort basket entries by event id
      // fixes https://pricenow.atlassian.net/browse/T1-581
      this.basketEntries.sort((a, b) => {
        return a.getUserData().getEventId() - b.getUserData().getEventId()
      })

      // sort basket entries by product's sort order
      // fixes https://pricenow.atlassian.net/browse/T1-754
      this.basketEntries.sort((a, b) => {
        return (
          a.getProductDefinitionInstance().getProductInstance().getSortOrder() -
          b.getProductDefinitionInstance().getProductInstance().getSortOrder()
        )
      })
    }
    this.handleBasketMsg(basket.msg)
    return Promise
  }

  handleBasketMsg(msg) {
    if (msg) {
      EventBus.$emit('notify', i18n.t(`basket.${msg}`))
    }
  }

  /**
   * helper method for parseApi method. It sets the accurate current variables in the current shop module.
   * these variables are used to be stored also in the url
   * @param basketEntry
   * @returns {Promise<boolean>}
   */
  async setCurrentUrlQuery(basketEntry) {
    const currentShopModule = store.getters.getActiveModuleInstance()
    if (!currentShopModule) return false

    const productIdOfBasketEntry = basketEntry?.getProduct()?.getId()
    const productsInstance = currentShopModule?.getProductsInstance()
    const currentProductCategory = currentShopModule?.getCurrentProductCategory()
    let productIdsOfCurrentShopModule = []
    // if a current product category is set, only consider these products
    // this behaviour assures that the correct product properties are set in the active shop module as current
    if (currentProductCategory) {
      const productsByCurrentProductCategory = productsInstance.getProductsByProductCategory(
        currentProductCategory
      )
      productIdsOfCurrentShopModule = productsByCurrentProductCategory.map(
        (product) => product.id
      )
    } else {
      productIdsOfCurrentShopModule = productsInstance?.getProductsIds()
    }
    const isEvent = basketEntry?.isEventEntry()
    const isRequiredEntry = basketEntry?.isRequiredEntry()

    if (
      productIdsOfCurrentShopModule.includes(productIdOfBasketEntry) &&
      !isEvent &&
      !isRequiredEntry
    ) {
      await currentShopModule.setCurrentUrlQuery(
        basketEntry.getValidFrom('YYYY-MM-DD'),
        basketEntry.getProductDefinitionId(),
        basketEntry?.getUserData()?.getEventId()
      )
      return true
    }
    return false
  }

  /**
   * check if any of the basket entries is in a certain booking state
   * @param key
   * @returns {Boolean}
   */
  hasBasketEntriesInBookingState(key) {
    // iterate all basket entries
    for (let i = 0; i < this.basketEntries.length; i++) {
      let entry = this.basketEntries[i]
      if (entry.isEntryInBookingState(key)) return true
    }
    return false
  }

  // make basket entries editable again. But only those in the current booking process with the current baskets standard date.
  // @caller ShopModule.beforePreviousStep()
  async resetBasketEntriesToBookingStateInProgress() {
    EventBus.$emit('spinnerShow')

    // short cut
    let productsInstance = store.getters
      .getActiveModuleInstance()
      .getProductsInstance()

    // iterate basket entries
    for (let i = 0; i < this.basketEntries.length; i++) {
      let basketEntry = this.basketEntries[i]

      // reset basket entry if the valid date equals the standard date instance of the basket
      // AND it's the same product id as in the current shop module
      const currentDateInstance = this.getCurrentDateInstance()
      if (
        (!currentDateInstance ||
          basketEntry.getValidFrom().getTime() ===
            currentDateInstance.getTime()) &&
        (await productsInstance.includeProductDefinitionId(
          basketEntry.getProductDefinitionId()
        ))
      ) {
        // setting a basket entry in booking state 'inProgress'. See UserData.js
        basketEntry.getUserData().resetAll(basketEntry)

        // save the new basket entry
        // note: AWAIT is forbidden => basketEntry variable will be the same in the second iteration!!
        this.updateBasketEntry(basketEntry, false)
      }
    }

    EventBus.$emit('spinnerHide')

    return Promise
  }

  /**
   *  SETTERS
   */
  async setCauseWeCare(causeWeCare = !this.causeWeCare) {
    /* global EventBus axios store */
    EventBus.$emit('spinnerShow')

    try {
      const response = await peInstance().put(
        `/baskets/${this.uuid}/causeWeCare`,
        {
          causeWeCare: causeWeCare,
        }
      )

      await this.parseApiData(response.data)
      return Promise.resolve(true)
    } catch (e) {
      EventBus.$emit('notify', i18n.t('basket.causeWeCareNotUpdated'))
      return Promise.resolve(false)
    } finally {
      EventBus.$emit('spinnerHide')
    }
  }

  setComment(comment) {
    this.comment = comment
  }

  addBasketEntryToSelectedReductions(basketEntryId, type) {
    if (!this.basketEntriesForReduction[type])
      this.basketEntriesForReduction[type] = []
    this.basketEntriesForReduction[type].push(basketEntryId)
  }

  // check if the current basket is or was in use
  isBasketInUse() {
    return (
      this.basketEntries.length || this.vouchersInstance.getVouchers().length
    )
  }

  /**
   * Checks if basket contains at least one entry and if those all are transferable products.
   * @return {boolean}
   */
  basketContainsReservationsOnly() {
    let basketEntries = this.getBasketEntries()
    if (basketEntries.length) {
      // check if any of the basket entries is non-transferable
      for (let i = 0; i < basketEntries.length; i++) {
        if (
          !basketEntries[i].getProductDefinition().getProduct()?.isReservation()
        )
          return false
      }
      // all tickets were transferable
      return true
    }
    return false // no ticket at all
  }

  /**
   * do we have a particular user already in the basket for a certain product?
   * @param uid
   * @param productId
   * @returns {boolean}
   */
  userAndProductAlreadyAdded(uid, productId, eventId) {
    let count = 0

    // iterate basket entries
    for (let i = 0; i < this.basketEntries.length; i++) {
      let basketEntry = this.basketEntries[i]
      let productDefinitionInstance = basketEntry.getProductDefinitionInstance()
      let userData = basketEntry.getUserData()
      // user uid already with same product present in basket entries
      if (
        productDefinitionInstance.getProductInstance().oneTicketOnePerson ===
          true &&
        productDefinitionInstance.getProductId() === productId &&
        userData.getEventId() === eventId &&
        userData.getUid() === uid
      ) {
        if (count) return true
        count++
      }
    }

    return false
  }

  /**
   * is a particular card already used by another user?
   * @param uid
   * @param cardId
   * @returns {boolean}
   */
  cardAlreadyUsedByOtherUser(uid, cardId) {
    // iterate basket entries
    for (let i = 0; i < this.basketEntries.length; i++) {
      let basketEntry = this.basketEntries[i]

      if (
        basketEntry.getUserData().getUid() !== uid &&
        basketEntry.getUserData().getCardId() === cardId
      )
        return true
    }

    return false
  }

  /**
   * GETTERS
   */

  /**
   * get the first basket entry which is in progress
   * @returns {*}
   */
  getFirstBasketEntryInBookingState(bookingState) {
    // iterate basket entries
    for (let i = 0; i < this.basketEntries.length; i++) {
      let entry = this.basketEntries[i]
      if (entry.isEntryInBookingState(bookingState) && !entry.isRequiredEntry())
        return entry
    }

    return null
  }

  getLastBasketEntryInBookingState(bookingState) {
    for (let i = this.basketEntries.length; i > 0; i--) {
      let entry = this.basketEntries[i - 1]
      if (entry.isEntryInBookingState(bookingState) && !entry.isRequiredEntry())
        return entry
    }
    return null
  }

  /**
   * get first basket entry id which is not in particular booking state
   * @param bookingState
   * @returns {Promise<boolean|number>}
   */
  getIndexOfBasketEntryNotInBookingState(bookingState) {
    // iterate basket entries
    for (let i = 0; i < this.basketEntries.length; i++) {
      let basketEntry = this.basketEntries[i]

      if (!basketEntry.isEntryInBookingState(bookingState)) return i
    }

    return false
  }

  /**
   * get all entries which are in a particular booking state (definitions.basketBookingState.inProgress)
   * @returns Array
   */
  getBasketEntriesInState(
    state,
    groupByProductDefinition = false,
    considerActiveModule = false
  ) {
    const activeModule = considerActiveModule
      ? store.getters.getActiveModuleInstance()
      : false
    const stateIsArray = Array.isArray(state)
    let basketEntriesInState = []
    // iterate basket entries
    for (let i = 0; i < this.basketEntries.length; i++) {
      let entry = this.basketEntries[i]
      if (stateIsArray) {
        // iterate states
        for (let b = 0; b < state.length; b++) {
          if (entry.isEntryInBookingState(state[b], activeModule)) {
            basketEntriesInState.push(entry)
            break
          }
        }
      } else {
        if (entry.isEntryInBookingState(state, activeModule)) {
          basketEntriesInState.push(entry)
        }
      }
    }
    if (groupByProductDefinition) {
      return _.groupBy(basketEntriesInState, (basketEntry) => {
        return (
          basketEntry.getProductDefinitionId() +
          '-' +
          basketEntry.getValidFrom().getTime() +
          '-' +
          basketEntry.getUserData().getEventId() +
          '-' +
          basketEntry.getPrice()
        )
      })
    }
    return basketEntriesInState
  }

  /**
   * get all entries which are NOT in a particular booking state
   * @returns {Array}
   */
  getBasketEntriesNotInState(state, considerActiveModule = false) {
    let basketEntriesNotInState = []
    const activeModule = considerActiveModule
      ? store.getters.getActiveModuleInstance()
      : false
    // iterate basket entries
    for (let i = 0; i < this.basketEntries.length; i++) {
      let entry = this.basketEntries[i]
      if (!entry.isEntryInBookingState(state, activeModule)) {
        basketEntriesNotInState.push(entry)
      }
    }
    return basketEntriesNotInState
  }

  /**
   * probably the basket entries based on media don't have any uid because the pe can't know it
   * @returns {Promise<void>}
   */
  async setUidForAllBasketEntriesBasedOnMedia() {
    const basketEntriesBasedOnMedia = this.basketEntries.filter(
      (basketEntry) => {
        const userData = basketEntry.getUserData()
        return !userData.getUid() && !!userData.isBasedOnMedia()
      }
    )

    const uid = store.getters.getAppUserInstance()?.getUid()
    basketEntriesBasedOnMedia.forEach((basketEntry) => {
      const userData = basketEntry.getUserData()
      const isBasedOnMedia = userData.isBasedOnMedia()
      if (isBasedOnMedia) {
        userData.setUid(uid)
      }
    })
    if (basketEntriesBasedOnMedia.length) {
      await this.updateBasketEntries(basketEntriesBasedOnMedia)
    }
    return true
  }

  /**
   * check if all booking entries are in a certain booking state (e.g. ready for checkout)
   * @param state
   * @returns boolean
   */
  areAllBasketEntriesInState(state) {
    // iterate all basket entries
    for (let i = 0; i < this.basketEntries.length; i++) {
      let entry = this.basketEntries[i]

      if (!entry.isEntryInBookingState(state)) return false
    }

    return true
  }

  /**
   * Is the booked time span within the available dates of a product (considering availability range and validity dates)
   * @param basketEntries: BasketEntry[]
   * @return {boolean}
   */
  checkAvailableDates(basketEntries) {
    if (!basketEntries || !basketEntries.length) {
      throw new Error('No product definitions provided in duration check')
    }
    const shopModulesInstance = store.getters.getShopModulesInstance()
    // iterate product definitions
    for (let i = 0; i < basketEntries.length; i++) {
      const basketEntry = basketEntries[i]
      if (basketEntry.isRequiredEntry() || basketEntry.isEventEntry()) {
        // no product would be found
        continue
      }
      const bookingStart = basketEntry.getValidFrom()
      const productDefinition = basketEntry.getProductDefinition()
      const productId = productDefinition.getProductId()
      const productInstance = shopModulesInstance.getProductInstanceByProductId(
        productId
      )
      const checkResult = productInstance.checkAvailableDates(
        productDefinition,
        bookingStart
      )
      if (!checkResult) {
        return false
      }
    }
    return true
  }

  /**
   * LATEST BOOKING TIME CONSTRAINT
   */

  /**
   * check all basket entries for latestBookingTime constraints
   */
  areAllBasketEntriesInTime() {
    // check time constraint for each basket entry
    for (let i = 0; i < this.basketEntries.length; i++) {
      let basketEntry = this.basketEntries[i]
      let productDefinition = basketEntry.getProductDefinition()
      if (!productDefinition.isLatestBookingTimeOk(basketEntry.getValidFrom()))
        return false
    }

    return true
  }

  /**
   * get all basket entries containing a particular attribute key an value and sum the prices
   * @param key
   * @param value
   * @returns {number}
   */
  getTotalPriceOnAttributeAndBookingState(key, value, bookingState, productId) {
    let sum = 0
    let filteredBasketEntries = this.getBasketEntriesWithAttributeAndBookingState(
      key,
      value,
      bookingState
    ).filter((entry) => {
      return entry.getProductDefinitionInstance().getProductId() === productId
    })

    // iterate filtered basket entries
    for (let i = 0; i < filteredBasketEntries.length; i++) {
      sum += parseFloat(filteredBasketEntries[i].getPrice())
    }

    return sum
  }

  // do we have any vat rates
  hasVats() {
    return this.vatsInstance.getVats().length > 0
  }

  // short cut
  getVatsArray() {
    return this.vatsInstance.getVats()
  }

  getTotalWithoutVats() {
    return this.getPriceNet() - this.vatsInstance.getTotalPrice()
  }

  getDiscounts() {
    return this.discounts
  }

  getPriceGross() {
    return this.priceGross
  }

  getPriceNet() {
    return this.priceNet
  }

  getPriceNetAndVouchersSubtracted() {
    return this.getPriceNet() - this.vouchersInstance.getTotalValue()
  }

  /**
   * get all basket entries having a particular attribute key and value (e.g. key = age and value = 'adult')
   * if bookingState is passed falsy, it will not be taken in account.
   * @param key
   * @param value
   * @param bookingState
   * @param countRequiredBasketEntries
   * @param productId
   * @param dateInstance
   * @param productDefinitionId
   * @returns {[]}
   */
  getBasketEntriesWithAttributeAndBookingState(
    key,
    value,
    bookingState,
    countRequiredBasketEntries = null,
    productId = null,
    dateInstance = false,
    productDefinitionId = null
  ) {
    let basketEntries = []
    const activeModule = store.getters.getActiveModuleInstance()

    // iterate basket entries
    for (let i = 0; i < this.basketEntries.length; i++) {
      const basketEntry = this.basketEntries[i]
      const productDefinition = basketEntry.getProductDefinitionInstance()
      if (
        productDefinition.getAttributeValueByKey(key) === value &&
        (!bookingState || basketEntry.isEntryInBookingState(bookingState)) &&
        (!basketEntry.isRequiredEntry() ||
          (countRequiredBasketEntries && basketEntry.isRequiredEntry)) &&
        (!dateInstance ||
          dateInstance.getTime() ===
            new Date(basketEntry.getValidFrom()).getTime()) &&
        (!productId || productId === productDefinition.getProductId()) &&
        (productDefinitionId === null ||
          productDefinitionId === productDefinition.getId()) &&
        activeModule.getProductInstanceByProductDefinitionId(
          basketEntry.getProductDefinitionId()
        )
      ) {
        basketEntries.push(basketEntry)
      }
    }

    return basketEntries
  }

  /**
   * get all basket entries having a particular attribute key and value and are of a certain product
   * @param key
   * @param value
   * @param productId
   * @returns {[]}
   */
  getBasketEntriesWithAttributeAndProductId(
    key,
    value,
    productId,
    dateInstance
  ) {
    let basketEntries = []

    // iterate basket entries
    for (let i = 0; i < this.basketEntries.length; i++) {
      let basketEntry = this.basketEntries[i]
      let productDefinition = basketEntry.getProductDefinitionInstance()
      if (
        productDefinition.getAttributeValueByKey(key) === value &&
        productDefinition.getProductId() === productId &&
        basketEntry.validFrom.getTime() === dateInstance.getTime()
      ) {
        basketEntries.push(basketEntry)
      }
    }

    return basketEntries
  }

  /**
   * return all basket entries which are of a particular product (via product id)
   * @param productId
   * @returns {[]}
   */
  getBasketEntriesOfProductId(productId, dateInstance) {
    let basketEntries = []

    // iterate basket entries
    for (let i = 0; i < this.basketEntries.length; i++) {
      let basketEntry = this.basketEntries[i]
      let productDefinition = basketEntry.getProductDefinitionInstance()
      if (
        productDefinition.getProductId() === productId &&
        basketEntry.validFrom.getTime() === dateInstance.getTime()
      )
        basketEntries.push(basketEntry)
    }

    return basketEntries
  }

  /**
   * Are the booking constraints over all basket entries fulfilled?
   * Short hand method
   * @returns {boolean}
   */
  basketConditionsMet() {
    // group basket entries by date to verify the conditions isolated by date
    const basketEntriesByDate = _.groupBy(this.basketEntries, (basketEntry) => {
      return basketEntry.getValidFrom().getTime()
    })
    // check conditions for each date group
    for (let date in basketEntriesByDate) {
      const productDefinitions = basketEntriesByDate[date].map((basketEntry) =>
        basketEntry.getProductDefinition()
      )
      const conditionsMet = this.getAllBasketConditions().basketConditionsMet(
        productDefinitions,
        true
      )
      if (!conditionsMet) return false
    }
    return true
  }

  /**
   * Get all basket conditions out of the basket entries, flatten and unioned.
   * @returns {BasketConditions}
   */
  getAllBasketConditions() {
    // First get all basket conditions out of each product
    const basketEntriesConditions = this.basketEntries.map((basketEntry) => {
      return basketEntry
        .getProduct()
        .getBasketConditions()
        .getBasketConditions()
    })
    // flatten them
    const flattenBasketEntriesConditions = _.flattenDeep(
      basketEntriesConditions
    )
    // remove multiple used conditions with the help of lodash's union method
    const basketConditions = _.unionBy(
      flattenBasketEntriesConditions,
      (basketCondition) => basketCondition.id
    )
    // create the BasketConditions instance to make use of it's methods
    return new BasketConditions(basketConditions)
  }

  /**
   * Does any basket entry contains the productId ?
   * @param productId
   */
  containsProductId(productId) {
    return this.basketEntries.find(
      (basketEntry) =>
        basketEntry.getProductDefinitionInstance().getProductId() === productId
    )
  }
  containsProductName(productName) {
    return this.basketEntries.find(
      (basketEntry) => basketEntry.getProduct().getName() === productName
    )
  }

  getCurrentProductDefinition() {
    return store.getters
      .getActiveModuleInstance()
      ?.getCurrentProductDefinition()
  }

  getCurrentDateInstance() {
    return store.getters.getActiveModuleInstance()?.getCurrentDateInstance()
  }

  getBasketEntries(groupByProductDefinition = false) {
    if (groupByProductDefinition) {
      return _.groupBy(this.basketEntries, (basketEntry) => {
        return (
          basketEntry.getProductDefinitionId() +
          '-' +
          basketEntry.getValidFrom().getTime() +
          '-' +
          basketEntry.getUserData().getEventId() +
          '-' +
          basketEntry.getPrice()
        )
      })
    }
    return this.basketEntries
  }

  getBasketEntriesWithRequirerId(basketEntryId) {
    return this.basketEntries.filter(
      (basketEntry) => basketEntry.requirerBasketEntryId === basketEntryId
    )
  }

  countBasketEntries() {
    return this.basketEntries.length
  }

  getVouchers() {
    return this.vouchersInstance.getVouchers()
  }

  getVouchersInstance() {
    return this.vouchersInstance
  }

  getVouchersAsArray() {
    return this.vouchersInstance.getVouchersAsArray()
  }

  getPromoCodesAsArray() {
    return this.promoCodes.getPromoCodes()
  }

  getUuid() {
    return this.uuid
  }

  getValidUntil() {
    return this.validUntil
  }

  getComment() {
    return this.comment
  }

  isCommentLengthOk() {
    return !this.comment || this.comment.length <= 240
  }

  getBasketEntriesForReduction(attributeKey) {
    return this.basketEntriesForReduction[attributeKey] || []
  }
}
