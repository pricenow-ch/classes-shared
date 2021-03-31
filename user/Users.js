import UserBookings from '../bookings/UserBookings'

/**
 * mainly holds an array with users
 */

export default class Users {
  constructor() {
    // not in use so far
    this._users = []

    // this are users with an array of bookings
    this._userBookings = []
  }

  /**
   * search for users with joined bookings on it
   * @param term
   * @returns {Promise<[]|Array>}
   */
  async searchUsersWithBookings(term, withBookings = false) {
    this._userBookings = []
    let url = withBookings ? 'admin/booking/search/' : 'admin/user/search/'

    try {
      let response = await axios.get(
        store.getters.getCurrentDestinationInstance().getShopApi() +
          url +
          encodeURI(term),
        {
          params: {
            mailRequired: true,
          },
        }
      )
      response.data.forEach((rawSearchResult) => {
        this._userBookings.push(new UserBookings(rawSearchResult))
      })
    } catch (e) {
      EventBus.$emit('notify', e.response)
    }

    return Promise.resolve(this._userBookings)
  }

  addUserBooking(userInstance) {
    this.userBookings.push(userInstance)
  }

  /**
   * GETTERS AND SETTERS
   */
  get users() {
    return this._users
  }

  set users(value) {
    this._users = value
  }

  get userBookings() {
    return this._userBookings
  }

  set userBookings(value) {
    this._userBookings = value
  }
}
