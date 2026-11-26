import type { LegalSection } from "../LegalPage";
import ExternalLink from "../ExternalLink/ExternalLink";
import LegalTable from "../LegalTable/LegalTable";
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal";
import { SITE_NAME } from "@/lib/site";

/*
 * Texto de la Política de privacidad (/privacy). Sale del relevamiento del código (REPORTE-paginas-legales.md): si cambia
 * qué se guarda, a quién se manda o cuánto dura, actualizar este texto y la fecha en src/lib/legal.ts.
 */

const mail = <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>;

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: "responsable",
    title: "Quién es el responsable",
    content: (
      <>
        <p>
          {SITE_NAME} es una guía para encontrar lugares para comer y tomar algo en Montevideo. El responsable de los datos
          que se tratan en el sitio es <strong>Mateo Blanco</strong>, en Montevideo, Uruguay.
        </p>
        <p>Para cualquier consulta sobre privacidad o para ejercer tus derechos, escribí a {mail}.</p>
        <p>
          Esta política se rige por la Ley N.º 18.331 de Protección de Datos Personales de Uruguay y su reglamentación.
        </p>
      </>
    ),
  },
  {
    id: "resumen",
    title: "En pocas palabras",
    content: (
      <ul>
        <li>No hay cuentas. No te pedimos nombre, mail, teléfono ni ningún otro dato para usar el sitio.</li>
        <li>
          Tus guardados, tus tarjetas y tu ubicación aproximada quedan en tu navegador. Nuestro servidor los usa para
          responder cada pedido y no los guarda.
        </li>
        <li>
          Contamos visitas a las fichas de forma anónima, para saber qué lugares interesan más. No guardamos tu IP ni nada
          que permita identificarte.
        </li>
        <li>
          Para entender cómo se usa el sitio (qué se busca, qué filtros se usan, qué se toca en las fichas) usamos
          Mixpanel. Le mandamos esos eventos y el texto de las búsquedas, sin tu ubicación, sin tus guardados y sin usar tu
          IP para ubicarte. No usa cookies ni te reconoce entre una visita y otra.
        </li>
        <li>
          Para entender lo que escribís en el buscador, el texto se manda a un modelo de inteligencia artificial. Solo el
          texto: ni tu ubicación ni tus guardados.
        </li>
        <li>No vendemos datos, no mostramos publicidad y no usamos cookies de terceros para seguirte.</li>
      </ul>
    ),
  },
  {
    id: "datos",
    title: "Qué datos tratamos y para qué",
    content: (
      <>
        <h3>Lo que queda en tu navegador</h3>
        <p>
          Lo que elegís en el sitio se guarda en tu propio navegador (almacenamiento local y cookies), no en una cuenta:
        </p>
        <ul>
          <li>
            <strong>Guardados:</strong> los lugares que marcás con el corazón y la fecha en que los guardaste. Sirven para
            mostrarte tu lista y para personalizar la home y las búsquedas (&quot;Para vos&quot;, &quot;Parecido a…&quot;).
          </li>
          <li>
            <strong>Mis tarjetas:</strong> el banco y el tipo de tarjeta (débito o crédito) que elegís para ver
            descuentos. Nunca el número de la tarjeta ni ningún otro dato de ella.
          </li>
          <li>
            <strong>Ubicación aproximada:</strong> solo si nos das permiso (ver <a href="#ubicacion">Tu ubicación</a>).
          </li>
          <li>
            <strong>Bienvenida:</strong> una marca para no volver a mostrarte la bienvenida de la home.
          </li>
        </ul>
        <p>
          Una copia de los guardados, las tarjetas y la ubicación viaja en una cookie con cada pedido a nuestro servidor,
          que la usa para armar esa respuesta (ordenar por cercanía, mostrar tus descuentos, personalizar) y no la guarda.
          El detalle de cada una está en <a href="#cookies">Cookies y almacenamiento local</a>.
        </p>

        <h3>Lo que llega a nuestro servidor</h3>
        <ul>
          <li>
            <strong>Medición anónima de visitas:</strong> cuándo se ve una ficha, se guarda o se saca un lugar, o se toca el
            link a Google Maps, sin datos que te identifiquen (ver{" "}
            <a href="#visitas">Medición anónima de visitas</a>).
          </li>
          <li>
            <strong>El texto de tus búsquedas:</strong> para encontrar lugares que coincidan (ver{" "}
            <a href="#busquedas">Tus búsquedas</a>).
          </li>
          <li>
            <strong>Datos técnicos de cada pedido:</strong> como en cualquier sitio web, tu navegador envía tu dirección IP,
            el tipo de navegador y dispositivo y la página que pedís. Nuestro proveedor de hosting los registra
            brevemente para operar el sitio y protegerlo de abusos. Nosotros no los usamos para identificarte.
          </li>
        </ul>

        <h3>Lo que mandamos a Mixpanel</h3>
        <p>
          Eventos de uso del sitio y el texto de las búsquedas, para entender cómo se usa (ver{" "}
          <a href="#uso">Cómo se usa el sitio (Mixpanel)</a>).
        </p>

        <h3>Lo que no pedimos</h3>
        <p>
          No hay registro ni inicio de sesión. No te pedimos nombre, mail, teléfono, documento ni datos de pago. Si nos
          escribís por mail, usamos tu dirección y lo que nos cuentes solo para responderte.
        </p>
      </>
    ),
  },
  {
    id: "visitas",
    title: "Medición anónima de visitas",
    content: (
      <>
        <p>
          Para saber qué lugares interesan más, contamos tres cosas en las fichas: que se vio la ficha, que se guardó (o se
          sacó) un lugar y que se tocó el link para llegar en Google Maps. Por cada una guardamos el lugar, qué pasó, el
          día y desde dónde llegaste a la ficha (por ejemplo, la búsqueda o una fila de la home). Nunca guardamos el texto
          de lo que buscaste.
        </p>
        <p>
          Para no contar dos veces a la misma persona en el mismo día, calculamos un <strong>código anónimo</strong>: una
          huella (hash) de tu dirección IP y de los datos de tu navegador, mezclados con una clave aleatoria que cambia
          cada día. La IP y los datos del navegador se usan solo para ese cálculo: no se guardan ni quedan en los
          registros. La clave de cada día se borra a la 1 de la mañana del día siguiente, así que después nadie (tampoco nosotros) puede
          volver a calcular el código ni relacionarlo con una persona. El mismo navegador tiene un código distinto cada
          día.
        </p>
        <p>
          Los registros individuales se borran a los <strong>90 días</strong>. Lo que queda son totales por lugar y por
          día (por ejemplo, &quot;este café tuvo 12 visitas el martes&quot;), sin ningún código.
        </p>
        <p>
          Además usamos Vercel Web Analytics y Speed Insights para contar visitas a las páginas y medir qué tan rápido carga
          el sitio. No usan cookies: registran la página visitada, de qué sitio llegaste, el tipo de navegador, dispositivo
          y sistema operativo y el país, e identifican la visita con una huella que Vercel descarta a las 24 horas. Antes
          de enviar la dirección de la página le sacamos el texto de búsqueda: lo que escribís en el buscador no llega a
          Vercel Analytics (sí a Mixpanel, ver <a href="#uso">Cómo se usa el sitio</a>).
        </p>
        <p>No se mide nada desde robots ni navegadores automatizados, y la medición no se usa para publicidad.</p>
      </>
    ),
  },
  {
    id: "uso",
    title: "Cómo se usa el sitio (Mixpanel)",
    content: (
      <>
        <p>
          Para entender cómo se usa el sitio y mejorarlo (qué se busca y si se encuentra, qué filtros sirven, qué se toca en
          las fichas, la home y las guías) usamos <strong>Mixpanel</strong>, un servicio de analítica de Mixpanel, Inc.,
          en Estados Unidos. Le mandamos:
        </p>
        <ul>
          <li>
            <strong>Eventos de uso:</strong> qué página se vio (la dirección sin parámetros y el título de la página), qué
            se tocó (por ejemplo, una pestaña, un filtro, un lugar de una búsqueda o del mapa, &quot;Guardar&quot;,
            &quot;Compartir&quot;, Google Maps o el link de un banco), hasta dónde se bajó en una lista de resultados y el
            lugar o la guía sobre la que fue.
          </li>
          <li>
            <strong>El texto de tus búsquedas</strong> (hasta 100 caracteres), con los filtros activos, cuántos resultados
            hubo y si había una ubicación disponible (sí o no, nunca cuál).
          </li>
          <li>
            Si en la bienvenida elegís tus tarjetas, qué bancos y tipos elegiste (débito o crédito), nunca el número.
          </li>
          <li>
            Datos técnicos que agrega Mixpanel: el tipo de navegador, sistema operativo y dispositivo y el tamaño de la
            pantalla.
          </li>
        </ul>
        <p>
          <strong>No le mandamos tu ubicación</strong> (ni coordenadas ni distancias), <strong>ni tus guardados</strong>,
          ni la dirección completa de la página. Tu navegador se conecta a los servidores de Mixpanel, así que recibe tu IP,
          pero le pedimos que <strong>no la use para ubicarte</strong> (no registra país ni ciudad).
        </p>
        <p>
          Mixpanel <strong>no usa cookies ni guarda nada en tu navegador</strong>: identifica la visita con un código al
          azar que vive solo en la memoria de la página y se pierde al recargarla o cerrarla. No te reconoce entre una
          visita y otra ni sabe quién sos. No se mide nada desde robots ni navegadores automatizados, y no se usa para
          publicidad. Esta medición es aparte de la <a href="#visitas">medición anónima de visitas</a> a las fichas.
        </p>
        <p>
          Lo que le mandamos queda en Mixpanel según su{" "}
          <ExternalLink href="https://mixpanel.com/legal/privacy-policy">política de privacidad</ExternalLink>. Como en
          el buscador, te recomendamos no escribir datos personales en él.
        </p>
      </>
    ),
  },
  {
    id: "ubicacion",
    title: "Tu ubicación",
    content: (
      <>
        <p>
          Para mostrarte lugares cerca tuyo, el sitio puede pedirle tu ubicación al navegador. Es opcional: solo se usa si
          aceptás en el aviso del navegador, y podés retirar el permiso cuando quieras desde su configuración.
        </p>
        <ul>
          <li>
            Se guarda <strong>aproximada</strong>, redondeada a unos 100 metros, en una cookie de tu navegador, durante 7
            días (se renueva cuando volvés con el permiso dado).
          </li>
          <li>
            Viaja a nuestro servidor con cada búsqueda para ordenar los lugares por distancia. No se guarda en el servidor
            ni se manda al modelo de inteligencia artificial.
          </li>
          <li>
            Si no das el permiso, lo recordamos durante un año para no volver a preguntarte solos (podés pedir
            &quot;Cerca mío&quot; cuando quieras).
          </li>
          <li>
            Los links que compartís con &quot;Cerca mío&quot; nunca llevan tus coordenadas: quien los abre ve lo que hay
            cerca suyo.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "busquedas",
    title: "Tus búsquedas",
    content: (
      <>
        <p>
          Cuando escribís algo en el buscador (por ejemplo, &quot;café tranquilo para trabajar en Cordón&quot;), el texto
          llega a nuestro servidor. Para entenderlo, muchas veces lo mandamos, a través de Vercel AI Gateway, a un modelo de
          lenguaje de Anthropic (Claude), que lo traduce a categorías y filtros, y a un modelo de OpenAI, que lo convierte
          en una representación numérica para encontrar lugares parecidos. Solo se manda el texto de la búsqueda: ni tu
          ubicación, ni tus guardados, ni tu IP.
        </p>
        <p>
          Para no pagar dos veces la misma búsqueda, guardamos en caché el resultado de esa interpretación (las categorías,
          barrios y partes del texto que el modelo reconoció) hasta <strong>30 días</strong> y la representación numérica
          hasta <strong>90 días</strong>. Se guarda por el texto buscado y no queda asociado a quién lo buscó.
        </p>
        <p>
          Según su{" "}
          <ExternalLink href="https://vercel.com/docs/ai-gateway/security-and-compliance">documentación</ExternalLink>,
          Vercel AI Gateway borra el texto y la respuesta apenas termina cada pedido (guarda solo datos de uso, como el
          modelo y la cantidad de texto procesado). Anthropic y OpenAI pueden conservarlo un tiempo
          limitado según sus políticas (por ejemplo, para seguridad y prevención de abusos) y, por defecto, no lo usan para
          entrenar sus modelos.
        </p>
        <p>
          El texto de la búsqueda también llega a Mixpanel, sin tu ubicación ni tus guardados, para saber qué se busca y si
          se encuentra (ver <a href="#uso">Cómo se usa el sitio</a>).
        </p>
        <p>
          <strong>Te recomendamos no escribir datos personales en el buscador</strong> (tu nombre, el de otra persona, un
          teléfono o una dirección): no hacen falta para encontrar un lugar.
        </p>
      </>
    ),
  },
  {
    id: "terceros",
    title: "Servicios de terceros y transferencias internacionales",
    content: (
      <>
        <p>
          Para funcionar, el sitio usa los servicios de estas empresas. Algunas reciben datos técnicos de tu navegador
          (como tu IP) porque tu navegador se conecta a ellas directamente.
        </p>
        <ul>
          <li>
            <strong>Vercel</strong> (Estados Unidos): aloja el sitio y lo sirve desde su red global, con servidores en São
            Paulo (Brasil). También brinda la analítica, la caché de búsquedas y el acceso a los modelos de inteligencia
            artificial.{" "}
            <ExternalLink href="https://vercel.com/legal/privacy-policy">Política de privacidad de Vercel</ExternalLink>.
          </li>
          <li>
            <strong>Anthropic</strong> (Estados Unidos): interpreta el texto de las búsquedas.{" "}
            <ExternalLink href="https://www.anthropic.com/legal/privacy">Política de privacidad de Anthropic</ExternalLink>.
          </li>
          <li>
            <strong>OpenAI</strong> (Estados Unidos): convierte el texto de las búsquedas en una representación numérica.{" "}
            <ExternalLink href="https://openai.com/policies/privacy-policy">Política de privacidad de OpenAI</ExternalLink>.
          </li>
          <li>
            <strong>Mixpanel</strong> (Estados Unidos): la analítica de uso del sitio, con el texto de las búsquedas y sin
            tu ubicación ni tus guardados (ver <a href="#uso">Cómo se usa el sitio</a>). Tu navegador se conecta
            directamente a sus servidores.{" "}
            <ExternalLink href="https://mixpanel.com/legal/privacy-policy">Política de privacidad de Mixpanel</ExternalLink>.
          </li>
          <li>
            <strong>Google Maps Platform</strong> (Google, Estados Unidos): los mapas interactivos, la imagen del mapa en la
            ficha en el teléfono y datos del lugar como el puntaje, los horarios y la dirección. Tu navegador carga los mapas
            directamente de Google, que recibe tu IP y datos del navegador. Los datos de cada lugar los pide nuestro
            servidor, solo con el identificador del lugar, sin ningún dato tuyo. El uso de Google Maps está sujeto a la{" "}
            <ExternalLink href="https://policies.google.com/privacy">Política de Privacidad de Google</ExternalLink>.
          </li>
          <li>
            <strong>Neon</strong> (Databricks; servidores en São Paulo, Brasil): la base de datos con los lugares y la
            medición anónima de visitas.{" "}
            <ExternalLink href="https://www.databricks.com/legal/privacynotice">Aviso de privacidad de Databricks</ExternalLink>.
          </li>
          <li>
            <strong>Cloudflare</strong> (Estados Unidos, red global): guarda y sirve los logos de los lugares, que tu
            navegador carga directamente.{" "}
            <ExternalLink href="https://www.cloudflare.com/privacypolicy/">Política de privacidad de Cloudflare</ExternalLink>.
          </li>
          <li>
            <strong>Fontshare</strong> (Indian Type Foundry, India): sirve la tipografía del texto (Switzer), que tu
            navegador carga directamente. La de los títulos (Merriweather) se sirve desde nuestro propio sitio.{" "}
            <ExternalLink href="https://www.indiantypefoundry.com/privacy-policy">
              Política de privacidad de Indian Type Foundry
            </ExternalLink>
            .
          </li>
        </ul>
        <p>
          Estos servidores están fuera de Uruguay (en Brasil, Estados Unidos, India o repartidos en redes globales), así
          que usar el sitio implica una transferencia internacional de esos datos técnicos, del texto de tus búsquedas y de
          los eventos de uso que mandamos a Mixpanel, a países que pueden no tener un nivel de protección equivalente al uruguayo. Solo compartimos lo necesario para
          que el sitio funcione y elegimos proveedores con compromisos públicos de seguridad y privacidad.
        </p>
        <p>
          Los links a Instagram, WhatsApp, Google Maps, los sitios de los lugares y los de los bancos te llevan a otros
          sitios, con sus propias políticas. Solo se abren si los tocás.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies y almacenamiento local",
    content: (
      <>
        <p>
          Usamos solo cookies y almacenamiento propios, para que funcione lo que elegís. No usamos cookies de publicidad ni
          de terceros: Mixpanel tampoco usa cookies ni guarda nada en tu navegador.
        </p>
        <LegalTable
          caption="Cookies y almacenamiento local"
          head={["Nombre", "Tipo", "Para qué sirve", "Cuánto dura"]}
          rows={[
            [<code key="n">cityPlans.saved</code>, "Almacenamiento local", "Tus guardados y la fecha de cada uno.", "Hasta que los borres"],
            [<code key="n">saved</code>, "Cookie", "Copia de tus guardados (solo los lugares) para personalizar la home y las búsquedas.", "1 año"],
            [<code key="n">cityPlans.cards</code>, "Almacenamiento local", "Tus tarjetas (banco y débito o crédito).", "Hasta que las borres"],
            [<code key="n">cards</code>, "Cookie", "Copia de tus tarjetas para mostrarte sus descuentos.", "1 año"],
            [
              <code key="n">loc</code>,
              "Cookie",
              "Tu ubicación aproximada (unos 100 m), o que no diste permiso o que no se pudo obtener.",
              "7 días con ubicación; 1 año si no diste permiso; hasta cerrar el navegador si no se pudo obtener",
            ],
            [<code key="n">cityPlans.welcome</code>, "Almacenamiento local", "Que ya viste la bienvenida de la home.", "Hasta que lo borres"],
          ]}
        />
        <p>
          Podés borrar todo esto cuando quieras desde la configuración de tu navegador (borrar los datos de este sitio). Si
          bloqueás el almacenamiento, el sitio sigue funcionando, pero sin guardados, tarjetas ni ubicación.
        </p>
      </>
    ),
  },
  {
    id: "conservacion",
    title: "Cuánto tiempo conservamos cada cosa",
    content: (
      <LegalTable
        caption="Plazos de conservación"
        head={["Qué", "Dónde", "Cuánto tiempo"]}
        rows={[
          ["Guardados, tarjetas y bienvenida", "Tu navegador", "Hasta que los borres (las cookies espejo, 1 año)"],
          ["Ubicación aproximada", "Tu navegador", "7 días; si no diste permiso, 1 año"],
          ["Clave del día para el código anónimo", "Nuestra base", "Se borra a la 1 de la mañana del día siguiente"],
          ["Registros de visitas a fichas (con el código anónimo)", "Nuestra base", "90 días"],
          ["Totales de visitas por lugar y por día", "Nuestra base", "Sin plazo (no identifican a nadie)"],
          ["Interpretación de una búsqueda", "Caché en Vercel", "Hasta 30 días"],
          ["Representación numérica de una búsqueda", "Caché en Vercel", "Hasta 90 días"],
          ["Datos técnicos de los pedidos (IP, navegador, página)", "Registros de Vercel", "Un período breve, según el plan de Vercel"],
          ["Eventos de uso y texto de las búsquedas", "Mixpanel", "Según la política de Mixpanel"],
          ["Mails que nos mandes", "Nuestro correo", "Lo necesario para responderte"],
        ]}
      />
    ),
  },
  {
    id: "derechos",
    title: "Tus derechos",
    content: (
      <>
        <p>
          Según la Ley N.º 18.331 tenés derecho a <strong>acceder</strong> a tus datos, a pedir que se{" "}
          <strong>rectifiquen</strong>, se <strong>actualicen</strong> o se <strong>incluyan</strong>, y a pedir su{" "}
          <strong>supresión</strong>. Para ejercerlos, escribí a {mail} contando qué querés hacer. Te respondemos dentro de
          los plazos de la ley.
        </p>
        <p>
          Como no tenemos cuentas, casi todo lo tuyo está en tu navegador y lo podés ver y borrar vos mismo (sacando los
          guardados, cambiando tus tarjetas o borrando los datos del sitio). La medición de visitas es anónima: no podemos
          saber cuáles registros son tuyos, así que no podemos mostrártelos ni borrarlos uno por uno, pero se borran solos
          a los 90 días. Lo mismo pasa con lo que mandamos a Mixpanel: el código de cada visita se pierde al recargar la página, así que
          no podemos saber qué eventos son tuyos.
        </p>
        <p>
          Si creés que no respetamos tus derechos, podés presentar una denuncia ante la{" "}
          <ExternalLink href="https://www.gub.uy/unidad-reguladora-control-datos-personales/">
            Unidad Reguladora y de Control de Datos Personales (URCDP)
          </ExternalLink>
          , el organismo de control en Uruguay.
        </p>
      </>
    ),
  },
  {
    id: "menores",
    title: "Menores de edad",
    content: (
      <p>
        {SITE_NAME} no está dirigido a menores de 18 años: muchos de los lugares son bares. Como no pedimos datos
        personales, no sabemos la edad de quien usa el sitio. Si sos madre, padre o tutor y creés que un menor nos mandó
        datos personales (por ejemplo, por mail), escribinos y los borramos.
      </p>
    ),
  },
  {
    id: "cambios",
    title: "Cambios a esta política",
    content: (
      <p>
        Si cambia lo que hacemos con los datos, actualizamos esta página y la fecha de &quot;Última actualización&quot; de
        arriba. Si el cambio es importante (por ejemplo, un dato nuevo o un proveedor nuevo), lo avisamos también en el
        sitio.
      </p>
    ),
  },
  {
    id: "contacto",
    title: "Contacto",
    content: <p>Para cualquier duda sobre esta política o sobre tus datos: {mail}.</p>,
  },
];
