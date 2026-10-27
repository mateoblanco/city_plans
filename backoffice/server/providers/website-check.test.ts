import { describe, expect, it } from 'vitest'
import { websiteHostRejection, websiteRejection, websiteRejectionLabel } from './website-check.ts'

describe('websiteRejection', () => {
  it.each([
    ['https://wa.me/59899123456', 'whatsapp'],
    ['https://api.whatsapp.com/send?phone=59899123456', 'whatsapp'],
    ['https://walink.com/grasaburgerclub', 'whatsapp'],
    ['https://wa.link/abc123', 'whatsapp'],
    ['https://linktr.ee/cafe', 'link_aggregator'],
    ['https://bio.link/cafe', 'link_aggregator'],
    ['https://taplink.cc/cafe', 'link_aggregator'],
    ['https://www.instagram.com/cafe/', 'social'],
    ['https://www.facebook.com/cafe', 'social'],
    ['https://reserver.pro/marlon', 'reservations'],
    ['https://patrimonio.myrestoo.net/es/reservar', 'reservations'],
    ['https://pausat.setmore.com/', 'reservations'],
    ['https://oriundo.meitre.com/', 'reservations'],
    ['https://www.covermanager.com/reserve/cafe', 'reservations'],
    ['https://pandabar.ambit.la/', 'ordering'],
    ['https://www.pedidosya.com.uy/restaurantes/montevideo/cafe-menu', 'ordering'],
    ['https://www.rappi.com.uy/restaurantes/cafe', 'ordering'],
    ['https://www.tripadvisor.com.uy/Restaurant_Review-cafe.html', 'directory'],
    ['https://maps.app.goo.gl/abc', 'directory'],
    ['https://claude.ai/', 'shared_page'],
  ])('%s: %s', (url, reason) => {
    expect(websiteRejection(url)?.reason).toBe(reason)
    expect(websiteHostRejection(url)?.reason).toBe(reason)
  })

  it('dominio de otro país: .es, .mx, .co', () => {
    expect(websiteRejection('https://kntina.es/', ['KNTINA. Cocina de mercado.'])).toEqual({ reason: 'foreign_domain', detail: '.es' })
    expect(websiteRejection('https://pizzeria.com.mx/')?.reason).toBe('foreign_domain')
    expect(websiteRejection('https://cafe.co/')?.reason).toBe('foreign_domain')
  })

  it('contenido de otro país: precios en otra moneda, teléfono con otro prefijo o una ciudad extranjera', () => {
    expect(websiteRejection('https://peperoncinopizzeria.com/', ['Pizza grande $250 MXN'])).toMatchObject({ reason: 'foreign_content', detail: 'precios en mxn' })
    expect(websiteRejection('https://peperoncinopizzeria.com/', ['Pedidos al +52 614 410 2030'])).toMatchObject({ reason: 'foreign_content', detail: expect.stringContaining('+52') })
    expect(websiteRejection('https://peperoncinopizzeria.com/', ['Sucursales Cd. Chihuahua'])).toMatchObject({ reason: 'foreign_content', detail: expect.stringContaining('chihuahua') })
    expect(websiteRejection('https://tapas.com/', ['Menú del día 14,50 €'])).toMatchObject({ reason: 'foreign_content' })
  })

  it('una .com.ar que menciona Montevideo se acepta', () => {
    expect(websiteRejection('https://www.lapanerarosa.com.ar/', ['La Panera Rosa. Locales en Buenos Aires y Montevideo.'])).toBeNull()
  })

  it('contenido extranjero que también menciona Uruguay se acepta', () => {
    expect(websiteRejection('https://cafe.com/', ['Envíos a todo Uruguay. Precios en €.'])).toBeNull()
  })

  it('una web uruguaya normal, o en un constructor de sitios con dominio extranjero sin señales, se acepta', () => {
    expect(websiteRejection('https://www.lanuevaroma.com.uy/', ['Helados artesanales. Tel. 2709 1234. Precios en $.'])).toBeNull()
    expect(websiteRejection('https://lacantinadel258.webnode.es/', ['La Cantina del 25. Minutas y pizzas.'])).toBeNull()
    expect(websiteRejection('https://mvdsouffle.wixsite.com/souffle')).toBeNull()
  })

  it('una duda legible en español', () => {
    expect(websiteRejectionLabel({ reason: 'reservations', detail: 'pausat.setmore.com' })).toBe('sistema de reservas (pausat.setmore.com)')
  })
})
