define ->
  'use strict'

  class Profile extends Backbone.Model

    initialize: ->
      @localStorage = new Backbone.LocalStorage 'profiles'
      @.on 'change:name change:phone', ->
        @save()

    # id нужен, чтобы можно было найти модель из localStorage
    defaults:
      id:          1
      address:     ''
      phone:       ''
      name:        ''

    # TODO Валидация
    isAllFieldsFilled: ->
      true if @get('name') and @get('phone')
