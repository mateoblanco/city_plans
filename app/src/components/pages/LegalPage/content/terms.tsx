import Link from "next/link";
import type { LegalSection } from "../LegalPage";
import ExternalLink from "../ExternalLink/ExternalLink";
import { LEGAL_CONTACT_EMAIL, LEGAL_PAGES } from "@/lib/legal";
import { SITE_NAME } from "@/lib/site";

/* Texto de los Términos y condiciones (/terms). Al cambiarlo, actualizar la fecha en src/lib/legal.ts. */

const mail = <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>;
const privacy = <Link href={LEGAL_PAGES.privacy.path}>Política de privacidad</Link>;

export const TERMS_SECTIONS: LegalSection[] = [
  {
    id: "servicio",
    title: `Qué es ${SITE_NAME}`,
    content: (
      <>
        <p>
          {SITE_NAME} es una guía para encontrar lugares para comer y tomar algo en Montevideo: un buscador, fichas de cada
          lugar, descuentos de bancos y guías. Es <strong>gratuito</strong> y se usa <strong>sin cuenta</strong>.
        </p>
        <p>
          Lo ofrece Mateo Blanco, de Montevideo, Uruguay (contacto: {mail}). Al usar el sitio aceptás estos términos. Si no
          estás de acuerdo, no lo uses. Lo que hacemos con los datos está en la {privacy}.
        </p>
      </>
    ),
  },
  {
    id: "informacion",
    title: "La información puede cambiar o tener errores",
    content: (
      <>
        <p>
          Hacemos lo posible para que la información sea correcta, pero los horarios, precios, menús, descuentos,
          direcciones y demás datos de cada lugar cambian seguido y pueden estar desactualizados o tener errores. Algunos
          datos los arma un proceso automático a partir de fuentes públicas y otros vienen de Google.
        </p>
        <p>
          <strong>Antes de ir, conviene confirmar con el lugar</strong> lo que sea importante para vos (que esté abierto,
          un precio, una reserva, opciones sin TACC o veganas, accesibilidad).
        </p>
        <p>
          El buscador usa inteligencia artificial para interpretar lo que escribís y puede equivocarse o mostrar
          resultados que no son exactamente lo que buscabas.
        </p>
        <p>
          Si ves un error, escribinos a {mail} y lo corregimos.
        </p>
      </>
    ),
  },
  {
    id: "descuentos",
    title: "Descuentos de bancos",
    content: (
      <>
        <p>
          Los descuentos que mostramos los define cada banco o emisor de tarjetas, con sus propias condiciones (días,
          topes, tipos de tarjeta, vigencia, forma de pago). Los recopilamos de la información pública de cada banco como
          una ayuda, pero pueden cambiar o terminar sin aviso.
        </p>
        <p>
          Las condiciones que valen son las del banco: revisalas en su sitio (el link &quot;Ver más info&quot; de cada
          descuento) o con el lugar antes de pagar. No somos responsables si un descuento no se aplica.
        </p>
        <p>
          {SITE_NAME} <strong>no tiene relación comercial con los bancos ni con los lugares</strong>: no nos pagan por
          aparecer ni por mostrar sus descuentos.
        </p>
      </>
    ),
  },
  {
    id: "guias",
    title: "Guías y recomendaciones",
    content: (
      <p>
        Las guías y los lugares destacados son recomendaciones editoriales: los elegimos nosotros, según nuestro criterio.
        No son publicidad paga ni contenido patrocinado. Si alguna vez publicamos algo patrocinado, lo vamos a indicar
        claramente.
      </p>
    ),
  },
  {
    id: "marcas",
    title: "Marcas y datos de terceros",
    content: (
      <>
        <p>
          Los nombres, logos y marcas de los lugares, los bancos y otras empresas pertenecen a sus dueños. Los mostramos
          solo para identificarlos, y eso no implica que nos patrocinen, que tengamos una relación con ellos ni que avalen
          el sitio.
        </p>
        <p>
          Algunos datos de los lugares (puntaje, horarios, dirección, web) y los mapas vienen de Google Maps Platform y se
          muestran con su atribución. El uso de Google Maps en el sitio está sujeto a los{" "}
          <ExternalLink href="https://maps.google.com/help/terms_maps/">
            Términos Adicionales del Servicio de Google Maps/Google Earth
          </ExternalLink>{" "}
          y a la{" "}
          <ExternalLink href="https://policies.google.com/privacy">Política de Privacidad de Google</ExternalLink>.
        </p>
      </>
    ),
  },
  {
    id: "uso",
    title: "Uso aceptable",
    content: (
      <>
        <p>Podés usar el sitio libremente para uso personal. No está permitido:</p>
        <ul>
          <li>
            Extraer contenido de forma masiva o automatizada (scraping, robots, scripts) para copiarlo, armar otra base de
            datos o reutilizarlo, salvo los rastreadores que respetan nuestro archivo robots.txt.
          </li>
          <li>
            Usar el sitio de una forma que lo afecte o lo sobrecargue: mandar pedidos en cantidad, intentar acceder a partes
            no públicas, saltear sus límites o interferir con su funcionamiento.
          </li>
          <li>Usar el sitio para algo ilegal o para hacerle daño a otras personas o a los lugares.</li>
        </ul>
        <p>Podemos limitar o bloquear el acceso a quien no cumpla estas reglas.</p>
      </>
    ),
  },
  {
    id: "contenido",
    title: "Nuestro contenido",
    content: (
      <p>
        Los textos, las guías, las descripciones, la selección y organización de los lugares, el diseño y el código del
        sitio son de Mateo Blanco ({SITE_NAME}), salvo lo que es de terceros (marcas, logos, datos de Google). Podés compartir links y
        citar fragmentos breves nombrando a {SITE_NAME} con un link a la página, pero no copiar o republicar el contenido
        sin permiso.
      </p>
    ),
  },
  {
    id: "enlaces",
    title: "Enlaces a otros sitios",
    content: (
      <p>
        El sitio tiene links a otros sitios (Google Maps, Instagram, WhatsApp, los sitios de los lugares y de los bancos).
        No los controlamos ni somos responsables por su contenido, sus condiciones ni lo que hacen con tus datos: cada uno
        tiene las suyas.
      </p>
    ),
  },
  {
    id: "responsabilidad",
    title: "Limitación de responsabilidad",
    content: (
      <>
        <p>
          {SITE_NAME} se ofrece gratis y &quot;tal como está&quot;. No garantizamos que el sitio esté siempre disponible,
          sin errores, ni que la información sea completa, exacta o esté al día.
        </p>
        <p>
          No somos parte de lo que pase entre vos y un lugar o un banco: la atención, los productos, los precios, las
          reservas y los descuentos son responsabilidad de cada uno. En la medida que lo permita la ley, no respondemos por
          daños que resulten del uso del sitio o de confiar en su información. Nada de esto limita los derechos que te dan
          las leyes de defensa del consumidor ni otras normas que no se pueden dejar de lado.
        </p>
      </>
    ),
  },
  {
    id: "cambios",
    title: "Cambios en el servicio y en estos términos",
    content: (
      <p>
        Podemos cambiar, agregar o sacar funciones del sitio, o dejar de ofrecerlo. También podemos actualizar estos
        términos: la versión vigente es la de esta página, con su fecha de &quot;Última actualización&quot;. Si seguís
        usando el sitio después de un cambio, aceptás los términos nuevos.
      </p>
    ),
  },
  {
    id: "ley",
    title: "Ley aplicable y jurisdicción",
    content: (
      <p>
        Estos términos se rigen por las leyes de la República Oriental del Uruguay. Cualquier controversia se resuelve
        ante los tribunales competentes de la ciudad de Montevideo.
      </p>
    ),
  },
  {
    id: "contacto",
    title: "Contacto",
    content: <p>Para cualquier consulta sobre estos términos: {mail}.</p>,
  },
];
