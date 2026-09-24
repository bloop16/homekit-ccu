/*
 * File: ui.js
 * Project: homekit-ccu
 * File Created: Sunday, 15th March 2020 8:46:03 pm
 * Author: Thomas Kluge (th.kluge@me.com)
 * -----
 * The MIT License (MIT)
 * 
 * Copyright (c) Thomas Kluge <th.kluge@me.com> (https://github.com/thkl)
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 * ==========================================================================
 */

// Values from the CCU (device, room, bridge names) are shown as text, never parsed as HTML.
export function asText (value) {
  if ((value === undefined) || (value === null)) return ''
  if (typeof value === 'object') return value
  return $('<span>').text(String(value))
}

export function escapeHtml (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export class Label {
  constructor (label) {
    this.label = $('<div>')
    if (label) {
      this.label.append(label)
    }
  }

  setStyle (style) {
    this.label.attr('style', style)
  }

  setLabel (label) {
    this.label.empty()
    this.label.append(label)
  }

  render () {
    return this.label
  }
}

export class Spinner {
  constructor () {
    this.spinner = $('<div>').attr('role', 'status')
  }

  setActive (active) {
    if (active === true) {
      this.spinner.addClass('spinner-border')
    } else {
      this.spinner.removeClass('spinner-border')
    }
  }

  render () {
    return this.spinner
  }
}

export class Button {
  constructor (type, title, onClick, enabled = true) {
    this.isActive = enabled
    this.button = $('<button>')
    this.button.attr('type', 'button')
    this.button.addClass('btn')

    this.button.addClass('btn-' + type)
    if (!this.isActive) {
      this.button.attr('disabled', 'disabled')
    }
    this.button.on('click', (e) => {
      onClick(e, e.target)
    })
    this.button.append(title)
  }

  setStyle (style) {
    this.button.attr('style', style)
  }

  setLabel (lbl) {
    this.button.empty()
    this.button.append(lbl)
  }

  setActive (isActive) {
    this.isActive = isActive
    if (this.isActive) {
      this.button.removeAttr('disabled')
    } else {
      this.button.attr('disabled', 'disabled')
    }
  }

  render () {
    return this.button
  }
}

export class Input {
  constructor (id, value, onChange) {
    this.input = $('<input>').attr('id', id)
    if (onChange) {
      this.input.on('change', (e) => {
        onChange(e, e.target)
      })
    }
    this.input.addClass('form-control')
    this.input.val(value)
  }

  setStyle (style) {
    this.style = style
    if (this.container) {
      this.container.attr('style', this.style)
    }
  }

  setLabel (label) {
    this.label = $('<label>').addClass('form-label').attr('for', this.input.attr('id'))
    this.label.append(label)
  }

  setGroupLabel (label) {
    this.label = $('<span>').addClass('input-group-text').append(label)
    this.isGrouped = true
  }

  setEnabled (enabled) {
    if (enabled) {
      this.input.removeAttr('disabled', 'disabled')
    } else {
      this.input.attr('disabled', 'disabled')
    }
  }

  getFiles(id) {
    if (this.inputType  === 'file') {
      return this.input[0].files[id]
    }
    return undefined
  }

  setType (inputType) {
    this.inputType = inputType
  }

  setValue (newValue) {
    this.input.val(newValue)
  }

  getValue () {
    return this.input.val()
  }

  render () {
    if (this.label) {
      if (this.isGrouped === true) {
        this.container = $('<div>').addClass('input-group')
        this.container.append(this.label)
        this.container.append(this.input)
      } else {
        this.container = $('<div>').append(this.label).append(this.input)
      }
      if (this.style) {
        this.container.attr('style', this.style)
      }
      if (this.inputType) {
        this.input.attr('type',this.inputType)
      }

      return this.container
    } else {
      return this.input
    }
  }
}

export class CheckBox extends Input {
  constructor (id, value, onChange) {
    super(id, 'true', onChange)
    this.input.attr('type', 'checkbox')
    this.input.removeClass('form-control').addClass('form-check-input')
    this.setValue(value)
  }

  setLabel (label) {
    this.label = $('<label>').attr('for', this.input.attr('id'))
    this.label.addClass('form-check-label')
    this.label.append(label)
  }

  setValue (newValue) {
    this.input.prop('checked', newValue === true)
  }

  getValue () {
    return this.input.prop('checked') === true
  }

  render () {
    if (this.label) {
      let result = $('<div>').append(this.input).append(this.label)
      result.addClass('form-check')
      return result
    } else {
      return this.input
    }
  }
}

export class ButtonInput {
  constructor (id, value, title, onChange, onButton) {
    this.id = id
    this.input = $('<input>').attr('id', id)
    if (onChange) {
      this.input.on('change', (e) => {
        onChange(e, e.target)
      })
    }
    this.input.addClass('form-control')
    this.input.val(value)

    let button = $('<button>').addClass('btn btn-outline-secondary').attr('type', 'button').append(title)
    button.on('click', (e) => {
      onButton(e, e.target)
    })
    this.buttons = [button]
    this.container = $('<div>').addClass('input-group mb-3')
    this.container.append(this.input).append(this.buttons)
  }

  setLabel (label) {
    this.label = $('<label>').addClass('form-label').attr('for', this.id)
    this.label.append(label)
    this.isGrouped = false
  }

  setValue (newValue) {
    this.input.val(newValue)
    this.input.trigger('change')
  }

  getValue () {
    return this.input.val()
  }

  setStyle (style) {
    this.style = style
    if (this.container) {
      this.container.attr('style', this.style)
    }
  }

  setGroupLabel (label) {
    this.label = $('<span>').addClass('input-group-text').append(label)
    this.isGrouped = true
  }

  addButton (button) {
    let rendered = button.render()
    this.buttons.push(rendered)
    this.container.append(rendered)
  }

  render () {
    let group = $('<div>').addClass('input-group mb-3')
    if (this.label && this.isGrouped) {
      group.append(this.label)
    }
    group.append(this.input).append(this.buttons)
    if (this.inputType) {
      this.input.attr('type', this.inputType)
    }
    this.container = group
    let result = group
    if (this.label && !this.isGrouped) {
      result = $('<div>').append(this.label).append(group)
    }
    if (this.style) {
      result.attr('style', this.style)
    }
    return result
  }
}

export class Dropdown {
  constructor (id, title, onClick) {
    this.id = id
    this.items = []

    this.dropDown = $('<div>').addClass('dropdown w-100')
    this.button = $('<button>').attr('class', 'btn btn-outline-secondary dropdown-toggle btn-select w-100').attr('type', 'button')
    this.button.attr('id', 'dropdownMenuButton_' + this.id)
    this.button.attr('data-bs-toggle', 'dropdown')
    // dialogs scroll their body, a fixed menu is not cut off at its edge
    this.button.attr('data-bs-popper-config', '{"strategy":"fixed"}')
    this.button.attr('aria-expanded', false)
    this.buttonLabel = $('<span>').addClass('text-truncate')
    this.button.append(this.buttonLabel)
    this.setTitle(title)
    this.dropDown.append(this.button)
    this.dropDownItems = $('<div>').addClass('dropdown-menu').attr('aria-labelledby', 'dropdownMenuButton_' + this.id)
    this.dropDown.append(this.dropDownItems)
    // the fixed menu would otherwise be sized against the window, not the button
    this.button[0].addEventListener('show.bs.dropdown', () => {
      this.dropDownItems.css('min-width', this.button.outerWidth() + 'px')
    })
    this.button.on('click', (e) => {
      if (onClick) {
        onClick(e)
      }
    })
  }

  setTitle (newTitle) {
    this.buttonLabel.empty()
    this.buttonLabel.append(asText(newTitle))
  }

  reset () {
    this.dropDownItems.empty()
  }

  addItem (item) {
    let self = this
    let mItem = $('<button>').addClass('dropdown-item').attr('type', 'button').attr('data-value', item.value).text(item.title)
    mItem.attr('data-title', item.title)
    mItem.on('click', (e) => {
      let target = e.currentTarget
      self.setTitle(target.getAttribute('data-title'))
      if (item.onClick) {
        item.onClick(e, target.getAttribute('data-value'))
      }
    })
    this.dropDownItems.append(mItem)
  }

  render () {
    return this.dropDown
  }
}

export class Pagination {
  constructor (parent) {
    this.parent = parent
    this.pages = []
    this.maxPages = 8
    this.curStartPage = 0
  }

  addPage (id, isActive, title, start, onClick) {
    this.pages.push({id: id, isActive: isActive, title: title, start: start, onClick: onClick})
  }

  reset() {
    this.pages = []
  }

  setParent (parent) {
    this.parent = parent
  }

  setActivePage (pageNum) {
    this.activePage = pageNum
    this.pages.map(page => {
      page.isActive = (page.id === pageNum)
    })
    this.render()
  }

  reset () {
    this.pages = []
    this.curStartPage = 0
  }

  renderPage (num, title, active, enabled, callback) {
    let oLi = $('<li>').addClass('page-item')
    if (enabled) {
      oLi.attr('disabled', 'disabled')
    }

    if (active) {
      oLi.addClass('active')
    }
    let oAnc = $('<a>').addClass('page-link')
    oAnc.on('click', (e) => {
      if (callback) {
        callback(e, num)
      }
    })
    oAnc.attr('style', 'cursor:pointer')
    oAnc.append(title)
    oLi.append(oAnc)
    return oLi
  }

  render () {
    let self = this
    this.parent.empty()
    let canvas = this.parent
    if (!canvas.is('ul')) {
      canvas = $('<ul>')
      canvas.addClass('pagination')
      this.parent.append(canvas)
    }

    let lastPage = this.pages.length

    if (this.pages.length > this.maxPages) {
      let active = (this.curStartPage !== 0)
      let opage = this.renderPage(-1, (this.prevTitle || 'Previous'), false, active, (e, num) => {
        if (self.curStartPage > 0) {
          self.curStartPage = self.curStartPage - 1
        }
        self.render()
      })
      canvas.append(opage)
      lastPage = this.curStartPage + this.maxPages
    }

    for (var i = this.curStartPage; i < lastPage; i++) {
      let page = this.pages[i]
      if (page) {
        let opage = this.renderPage(page.id, page.title, page.isActive, true, (e, num) => {
          page.onClick(e, page)
        })
        canvas.append(opage)
      }
    }

    if (this.pages.length > this.maxPages) {
      let active = (this.curStartPage !== 0)
      let opage = this.renderPage(-1, (this.NextTitle || 'Next'), false, active, (e, num) => {
        if (self.curStartPage < (self.pages.length - self.maxPages)) {
          self.curStartPage = self.curStartPage + 1
        }
        self.render()
      })
      canvas.append(opage)
    }
  }
}

export class Dialog {
  constructor (settings) {
    this.dialogId = settings.dialogId
    this.dialog = $('<div>').attr('class', 'modal fade').attr('tabindex', '-1').attr('id', settings.dialogId)
    this.dialog.attr('aria-labelledby', settings.dialogId + '_title').attr('aria-hidden', 'true')
    let dDocument = $('<div>').attr('class', 'modal-dialog modal-dialog-centered')

    if (settings.dialogClass) {
      this.dialog.addClass(settings.dialogClass)
    }

    if (settings.size) {
      dDocument.addClass(settings.size)
    } else {
      dDocument.addClass('modal-lg')
    }

    if (settings.scrollable) {
      dDocument.addClass('modal-dialog-scrollable')
    }

    this.dialog.append(dDocument)

    let dContent = $('<div>').addClass('modal-content')
    dDocument.append(dContent)

    let dHeader = $('<div>').addClass('modal-header')
    dContent.append(dHeader)

    let dTitle = $('<h2>').addClass('modal-title fs-5').attr('id', settings.dialogId + '_title')
    if (settings.title) {
      dTitle.append(settings.title)
    }
    dHeader.append(dTitle)

    let dCloseButton = $('<button>').attr('type', 'button').attr('class', 'btn-close').attr('data-bs-dismiss', 'modal')
    dCloseButton.attr('aria-label', settings.labelClose || 'Close')
    dHeader.append(dCloseButton)

    this.body = $('<div>').addClass('modal-body').attr('id', settings.dialogId + '_content')
    dContent.append(this.body)

    let dFooter = $('<div>').addClass('modal-footer')
    dContent.append(dFooter)

    if (settings.buttons) {
      settings.buttons.forEach(button => {
        if (button) {
          dFooter.append(button.render())
        }
      })
    }
  }

  setBody (item) {
    let self = this
    this.body.empty()
    if (Array.isArray(item)) {
      item.forEach(iitem => {
        self.body.append(iitem)
      })
    } else {
      this.body.append(item)
    }
  }

  open () {
    let self = this
    // a dialog with the same id may still be fading out
    $('#' + this.dialogId).not(this.dialog).remove()
    $('body').append(this.dialog)
    let element = this.dialog[0]

    element.addEventListener('hide.bs.modal', () => {
      if (self.beforeClose) {
        self.beforeClose()
      }
    })

    element.addEventListener('hidden.bs.modal', () => {
      bootstrap.Modal.getOrCreateInstance(element).dispose()
      self.dialog.remove()
    })

    bootstrap.Modal.getOrCreateInstance(element).show()
  }

  close () {
    let instance = bootstrap.Modal.getInstance(this.dialog[0])
    if (instance) {
      instance.hide()
    }
  }
}

export class GridRow {
  constructor (id, settings = {}) {
    this.id = id
    this.cells = []
    this.settings = settings
  }

  addCell (szData, content, clazz,id = 'c1') {
    var cContent = content
    if (typeof content !== 'object') {
      cContent = $('<span>').append(content)
    }
    this.cells.push({id:this.id + '_' + id, sz: szData, content: cContent, clazz: clazz})
    return cContent
  }

  setClasses (classNames) {
    this.cssClazzName = classNames
  }

  hide() {
   this.domObj.hide()
  }

  render () {
    let self = this
    this.domObj = $('<div>').addClass('row')
    if ((this.settings) && (this.settings.rowStyle)) {
      this.domObj.attr('style', this.settings.rowStyle)
    }
    if (this.cssClazzName) {
      this.cssClazzName.split(' ').map(clazz => {
        this.domObj.addClass(clazz)
      })
    }
    this.cells.forEach(cell => {
      let oCell = $('<div>')
      if (cell.id) {
        oCell.attr('id',cell.id)
      }
      if (cell.sz) {
        oCell.addClass('col-sm-' + (cell.sz.sm || 12))
        oCell.addClass('col-md-' + (cell.sz.md || 6))
        oCell.addClass('col-lg-' + (cell.sz.lg || 3))
        oCell.addClass('col-xl-' + (cell.sz.xl || cell.sz.lg || 3))
      } else {
        oCell.addClass('col-auto')
      }
      oCell.append(cell.content)
      self.domObj.append(oCell)
    })
    return this.domObj
  }
}

export class Grid {
  constructor (id, settings = {}) {
    this.id = id
    this.rows = []
    this.settings = settings
    this.canvas = $('<div>')
  }

  resetRows () {
    this.rows = []
    this.canvas.empty()
  }

  addRow (id, rowSettings) {
    if (rowSettings === undefined) {
      rowSettings = this.settings
    }
    let row = new GridRow(this.id + '_' + id, rowSettings)
    this.rows.push(row)
    return row
  }

  render () {
    let self = this
    this.rows.map(row => {
      self.canvas.append(row.render())
    })
    return this.canvas
  }
}

export class DatabaseGrid extends Grid {
  constructor (id, dataset, settings = {}) {
    super(id, settings)
    this.dataset = dataset
    this.curRecord = 0
    this.maxRecords = 10
    this.pagination = new Pagination()
    this.pagination.maxPages = settings.maxPages || 8
    this.gridContainer = $('<div>')
    this.columnSort = -1
    this.sortReverse = false
  }

  setColumns (colums) {
    this.columns = colums
  }

  setBeforeQuery(beforeQuery) {
    this.beforeQuery = beforeQuery
  }

  setTitleLabels (titleLabels) {
    this.titleLabels = titleLabels
  }

  addSearchBar (label, clearButtonTitle, filterCallback) {
    let self = this
    this.searchInput = new ButtonInput(this.id + '_search', '', clearButtonTitle, (e, input) => {
      self.filter = input.value
      self.pagination.reset()
      self.renderPagination(0)
      self.updateBody()
    }, (e, btn) => {
      self.searchInput.setValue('')
      self.filter = ''
      self.pagination.reset()
      self.renderPagination(0)
      self.updateBody()
    })

    if (label) {
      this.searchInput.setGroupLabel(label)
    }
    this.filterCallback = filterCallback
  }

  resetSearch() {
    if (this.searchInput) {
      this.searchInput.setValue('')
      this.filter = ''
      this.pagination.reset()
      this.renderPagination(0)
      this.updateBody()
    }
  }

  getDataset () {
    let self = this
    if (this.beforeQuery) {
      this.beforeQuery()
    }
    // first try to ask the delegate for data
    if (this.dataset === undefined) {
      this.requestRefresh()
    }

    if (this.dataset === undefined) {
      return []
    }
    if ((this.filter !== undefined) && (this.filterCallback)) {
      return this.dataset.filter((element) => {
        return self.filterCallback(element, self.filter)
      })
    } else {
      return this.dataset
    }
  }

  getSortedDataset () {
    let self = this
    let ds = this.getDataset()
    if ((this.columnSort > -1) && (this.sortCallback)) {
      let sds = ds.sort((a, b) => {
        return self.sortCallback(this.columnSort, a, b)
      })
      return (self.sortReverse ? sds.reverse() : sds)
    }
    return ds
  }


  requestRefresh() {
    if (this.getDataset !== undefined) {
      // this.dataset = this.getDataset()
      if (this.beforeQuery) {
        this.beforeQuery()
      }
    }
  }

  setDataset (dataset) {
    this.dataset = dataset
    this.curRecord = 0
    this.maxRecords = 10
    this.updateBody()
  }

  setRenderer (callback) {
    this.renderder = callback
  }

  setMaxDataRecords (max) {
    this.maxRecords = max
  }

  prepare () {
    if (this.searchInput) {
      this.gridContainer.append(this.searchInput.render())
    }
    if (!this.footer) {
      this.footer = $('<div>')
    }
    let divPr = $('<div>').addClass('row')
    divPr.attr('style', 'margin-top:15px')
    this.footer.append(divPr)
    // only add a pager if there are more records than maxRecords
    let divPc = $('<div>').addClass('col-auto')
    divPr.append(divPc)
    this.pagination.setParent(divPc)
    this.renderPagination(0)
    this.canvas.attr('style', 'margin:15px')
  }

  sortGridByColumn (col) {
    this.columnSort = col
    this.updateBody()
  }

  updateBody () {
    // loop thru the first Datasets
    let self = this
    this.resetRows()
    let dataset = this.getSortedDataset()
    let max = this.curRecord + this.maxRecords
    if (max > dataset.length) {
      max = dataset.length
    }
    var i = 0
    var j = 0
    // add the titleRow
    let row = super.addRow()
    row.setClasses('dbgridtitle')
    if (this.columns) {
      this.columns.map(column => {
        let col = row.addCell(column.sz, self.titleLabels[j] || '')
        // add a sortable label if column is sortabel
        if (column.sort !== undefined) {
          col.on('click', (e) => {
            if (column.sort === self.columnSort) {
              self.sortReverse = !self.sortReverse
            } else {
              self.sortReverse = false
            }
            self.sortGridByColumn(column.sort)
          })
          col.addClass('clickable')
          if (column.sort === self.columnSort) {
            col.addClass(self.sortReverse ? 'sortbyreverse' : 'sortedby')
          }
        }
        j = j + 1
      })
    }
    for (let index = this.curRecord; index < max; index++) {
      const element = dataset[index]
      if (this.renderder) {
        let row = super.addRow()
        if (i % 2) {
          row.setClasses('dbgridline odd')
        } else {
          row.setClasses('dbgridline')
        }
        let renderedElements = this.renderder(row, element)
        j = 0
        this.columns.map(column => {
          row.addCell(column.sz, asText(renderedElements[j]))
          j = j + 1
        })
        i = i + 1
      }
    }
    super.render()
  }

  render () {
    this.prepare()
    this.updateBody()
    this.gridContainer.append(this.canvas)
    this.gridContainer.append(this.footer)
    return this.gridContainer
  }

  refresh () {
    this.pagination.reset()
    this.renderPagination(this.pagination.activePage)
    this.updateBody()
  }

  renderPagination (activePage = 0) {
    var cnt = 0
    var tcnt = 1
    let self = this
    if (this.getDataset().length > this.maxRecords) {
    // ((cnt >= start) && (cnt < start + count))
      while (cnt < this.getDataset().length) {
        this.pagination.addPage(tcnt - 1, false, tcnt, cnt, (e, page) => {
          self.curRecord = page.start
          self.updateBody()
          self.pagination.setActivePage(page.id)
        })
        cnt = cnt + this.maxRecords
        tcnt = tcnt + 1
      }
      this.pagination.setActivePage(activePage)
    } else {
      this.pagination.setActivePage(activePage)
    }
  }
}

export class SelectInput {
  constructor (id, label, onChange) {
    this.id = id
    this.onChange = onChange
    this.options = []
    if (label) {
      this.setLabel(label)
    }
  }

  setValue (newValue) {
    this.value = newValue
  }

  setOptions (list) {
    this.options = list || []
  }

  setLabel (label) {
    this.label = $('<label>').attr('for', this.id)
    this.label.addClass('form-label')
    this.label.append(label)
  }

  render () {
    let self = this
    this.input = $('<select>').addClass('form-select').attr('id', this.id)
    this.options.forEach(option => {
      let iOption = $('<option>').attr('value', option.value).text(option.title)
      if (option.value === self.value) {
        iOption.attr('selected', 'selected')
      }
      this.input.append(iOption)
    })
    this.input.on('change', (e) => {
      self.onChange(e, e.target)
    })

    if (this.label) {
      return $('<div>').addClass('mb-3').append(this.label).append(this.input)
    } else {
      return this.input
    }
  }
}
