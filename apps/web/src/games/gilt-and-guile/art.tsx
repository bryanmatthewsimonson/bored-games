import { KINDS, type Kind } from '@bored-games/gilt-and-guile';
import type { ComponentChildren } from 'preact';

/** Original, individually composed Art Deco theatre posters. No external assets. */
export function StageArt({
  kind = 'grandstage',
  panorama = false,
  artId,
}: {
  kind?: Kind;
  panorama?: boolean;
  artId?: string;
}) {
  const id = (artId ?? `stage-${kind}-${panorama ? 'wide' : 'poster'}`).replace(/:/g, '');
  const index = KINDS.indexOf(kind);
  const colors = ['#763047', '#25545a', '#795532', '#4b3f66', '#2c5550', '#633247'];
  const tone = colors[index % colors.length];
  const gold = '#e9c681',
    paper = '#f7e7ba',
    ink = '#1e2430',
    rose = '#ca786e';
  const person = (x: number, y: number, scale = 1, hat = false) => (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M-21 64 -15 23 0 15 15 23 24 64Z" fill={ink} />
      <path d="m-9 23 9 29 9-29-9 6Z" fill={paper} />
      <path d="m-3 27 3 15 4-15-4-3Z" fill={rose} />
      <ellipse cy="5" rx="10" ry="13" fill={gold} />
      <path d="M-10 6V-3Q0-14 10-3V4L3-3-10 2" fill={ink} />
      {hat && <path d="M-18-4H18V-8H9V-26H-9V-8H-18Z" fill={ink} />}
      <path d="m-14 26-15 29m42-29 16 24" fill="none" stroke={ink} stroke-width="9" />
    </g>
  );
  const book = (x: number, y: number, rot = 0) => (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <path
        d="M-31-30Q-15-35 0-24Q15-35 31-30V25Q13 20 0 31Q-13 20-31 25Z"
        fill={paper}
        stroke={gold}
        stroke-width="2"
      />
      <path
        d="M0-24V31M-25-19-6-15M6-15 25-19M-25-9-6-5M6-5 25-9M-25 1-6 5M6 5 25 1M-25 11-6 15M6 15 25 11"
        stroke={tone}
        stroke-width="2"
        fill="none"
      />
    </g>
  );
  const coin = (x: number, y: number, r: number, n: number) => (
    <g>
      <circle cx={x} cy={y} r={r} fill={gold} stroke={paper} stroke-width="2" />
      <circle cx={x} cy={y} r={r - 6} fill="none" stroke={tone} />
      <path d={`M${x} ${y - r + 11} ${x + 8} ${y} ${x} ${y + r - 11} ${x - 8} ${y}Z`} fill={tone} />
      {n > 1 && <circle cx={x} cy={y} r="3" fill={paper} />}
    </g>
  );
  const theatre = (wide = false) => (
    <g>
      <path
        d={wide ? 'M33 121V55L120 23 207 55V121Z' : 'M57 121V57L120 29 183 57V121Z'}
        fill={ink}
        stroke={gold}
        stroke-width="2"
      />
      <path d="M77 119V73Q120 24 163 73V119" fill={rose} />
      <path d="M92 119V76Q120 48 148 76V119Z" fill={tone} />
      <path d="M93 69Q114 104 95 116L110 116 116 72M147 69Q126 104 145 116L130 116 124 72" fill={ink} />
      <path d="M47 126H193M56 133H184M66 140H174M69 66V118M171 66V118" stroke={gold} stroke-width="3" />
      {[90, 105, 120, 135, 150].map((x) => (
        <circle key={x} cx={x} cy={52 - Math.abs(120 - x) / 3} r="2" fill={paper} />
      ))}
      <path d="m120 75 5 14 15 1-12 9 4 15-12-9-12 9 4-15-12-9 15-1Z" fill={gold} />
    </g>
  );
  const mask = (x: number, y: number, rotation: number, smile: boolean) => (
    <g transform={`translate(${x} ${y}) rotate(${rotation})`}>
      <path d="M-27-27Q0-35 27-27L23 8Q18 29 0 34Q-18 29-23 8Z" fill={smile ? gold : paper} />
      <path d="M-19-10Q-11-20-4-9M4-9Q11-20 19-10" stroke={tone} fill="none" stroke-width="4" />
      <path d={smile ? 'M-13 8Q0 27 13 8Z' : 'M-13 19Q0-1 13 19Z'} fill={tone} />
    </g>
  );
  let subject: ComponentChildren = null;
  switch (kind) {
    case 'penny':
      subject = (
        <>
          {coin(120, 79, 36, 1)}
          <path d="M75 127H165M86 133H154" stroke={gold} />
        </>
      );
      break;
    case 'banknote':
      subject = (
        <g transform="rotate(-12 120 80)">
          <path d="M54 43H186V115H54Z" fill={gold} />
          <path d="M61 50H179V108H61Z" fill="none" stroke={tone} stroke-width="2" />
          {coin(120, 79, 25, 2)}
          <path d="m74 64 9 15-9 15-9-15Zm92 0 9 15-9 15-9-15Z" fill={tone} />
        </g>
      );
      break;
    case 'endowment':
      subject = (
        <>
          {coin(85, 97, 25, 1)}
          {coin(150, 95, 27, 2)}
          {coin(120, 60, 34, 3)}
          <path d="m103 53 7 8 10-20 10 20 7-8-4 22h-26Z" fill={paper} />
        </>
      );
      break;
    case 'playbill':
      subject = (
        <g transform="rotate(-10 120 80)">
          <path d="M82 23H158V135H82Z" fill={paper} />
          <path d="M88 30H152V128H88Z" stroke={tone} fill="none" />
          <path d="M96 39H144V45H96ZM96 103H144V106H96ZM105 113H135V116H105Z" fill={tone} />
          {mask(120, 72, 0, true)}
        </g>
      );
      break;
    case 'playhouse':
      subject = theatre();
      break;
    case 'grandstage':
      subject = (
        <>
          {theatre(true)}
          <path d="m120 9 4 7 8 1-6 5 2 8-8-5-8 5 2-8-6-5 8-1Z" fill={paper} />
        </>
      );
      break;
    case 'scandal':
      subject = (
        <>
          {book(119, 84, -14)}
          <path d="m135 24-34 51 23 1-18 53 40-63-25 1 24-43Z" fill={rose} stroke={ink} stroke-width="2" />
        </>
      );
      break;
    case 'rehearsal':
      subject = (
        <>
          {person(83, 67, 0.85)}
          {person(148, 67, 0.85)}
          <path d="M55 131H184M112 52V102M108 99H128" stroke={gold} stroke-width="2" />
          <circle cx="115" cy="51" r="6" fill={gold} />
        </>
      );
      break;
    case 'arcade':
      subject = (
        <g fill={ink} stroke={gold} stroke-width="2">
          <path d="M37 127V59L120 26 203 59V127Z" />
          <path d="M48 67H192M48 58H192" />
          {[71, 120, 169].map((x) => (
            <path key={x} d={`M${x - 16} 125V85a16 16 0 0 1 32 0V125Z`} fill={rose} />
          ))}
          <path d="M31 131H209" />
        </g>
      );
      break;
    case 'impresario':
      subject = (
        <>
          {person(116, 58, 1.15, true)}
          <path d="M142 111 180 87M180 87 183 80" stroke={gold} stroke-width="3" />
        </>
      );
      break;
    case 'rivalry':
      subject = (
        <>
          {person(74, 65, 1, true)}
          {person(172, 65, 1, true)}
          <path d="m120 33-12 34 13-1-11 31 27-43-14 2 9-23Z" fill={rose} />
        </>
      );
      break;
    case 'investor':
      subject = (
        <>
          {person(93, 56, 1.1, true)}
          {coin(160, 100, 25, 3)}
          <path d="M71 134H184" stroke={gold} />
        </>
      );
      break;
    case 'understudy':
      subject = (
        <>
          {mask(104, 78, -18, true)}
          <path d="M136 24Q176 60 143 136H194V24Z" fill={rose} />
          <path d="M151 28Q179 63 151 125" fill="none" stroke={gold} />
          <path d="m70 39 4-11 5 11 11 4-11 4-5 11-4-11-11-4Z" fill={paper} />
        </>
      );
      break;
    case 'renovation':
      subject = (
        <>
          {theatre()}
          <path d="m64 118 102-91 7 8-102 91Z" fill={gold} />
          <path d="m157 29 13-14 24 25-13 13Z" fill={paper} />
        </>
      );
      break;
    case 'scriptroom':
      subject = (
        <>
          {book(91, 87, -10)}
          {book(145, 87, 10)}
          <path d="M128 107Q151 57 170 27Q181 45 161 65Z" fill={gold} />
        </>
      );
      break;
    case 'ensemble':
      subject = (
        <>
          {person(67, 76, 0.8)}
          {person(173, 76, 0.8)}
          {person(120, 49, 1.2)}
          <path d="M48 135H191" stroke={gold} />
        </>
      );
      break;
    case 'propmaker':
      subject = (
        <>
          <path d="M59 100H182V111H59ZM69 111V137M170 111V137" stroke={gold} fill={ink} stroke-width="3" />
          {mask(117, 65, 15, true)}
          <path d="m155 93 12-52 7 2-10 52Z" fill={paper} />
        </>
      );
      break;
    case 'costumier':
      subject = (
        <>
          <path
            d="M111 29H129L133 57 167 121Q120 142 73 121L107 57Z"
            fill={rose}
            stroke={gold}
            stroke-width="2"
          />
          <path d="M108 57 132 57M120 123V62M100 117 113 64M140 117 127 64" stroke={paper} />
          <path d="M120 29V18M108 19H132" stroke={gold} />
        </>
      );
      break;
    case 'headliner':
      subject = (
        <>
          <path d="m120 19 17 34 39 5-28 28 6 40-34-19-34 19 6-40-28-28 39-5Z" fill={gold} />
          {person(120, 60, 0.9)}
          <path d="M52 32 77 51M188 32 163 51" stroke={paper} />
        </>
      );
      break;
    case 'booking':
      subject = (
        <>
          <path d="M64 133V45Q120 6 176 45V133Z" fill={gold} />
          <path d="M75 99V50Q120 20 165 50V99Z" fill={ink} />
          {person(120, 58, 0.65)}
          <path d="M65 101H175V112H65Z" fill={rose} />
          <path d="M87 122H153" stroke={ink} stroke-width="4" />
        </>
      );
      break;
    case 'cuttingroom':
      subject = (
        <>
          <path d="M76 27H153V125H76Z" fill={paper} />
          <path d="M87 42H139M87 51H139M87 60H139" stroke={tone} stroke-width="2" />
          <g transform="rotate(-30 136 94)" stroke={gold} stroke-width="6" fill="none">
            <circle cx="119" cy="111" r="12" />
            <circle cx="150" cy="111" r="12" />
            <path d="m125 101 29-56m-9 56-29-56" />
          </g>
        </>
      );
      break;
    case 'openingnight':
      subject = (
        <>
          {theatre(true)}
          <path d="m44 20 3 9 9 3-9 3-3 9-3-9-9-3 9-3Zm151 0 3 9 9 3-9 3-3 9-3-9-9-3 9-3Z" fill={paper} />
          <path d="M86 145 107 111H133L155 145Z" fill={rose} />
        </>
      );
      break;
    case 'gala':
      subject = (
        <>
          <path
            d="M81 27H117L113 65Q99 87 85 65ZM126 35H161L156 73Q143 94 130 73Z"
            fill={paper}
            opacity=".95"
          />
          <path d="M85 49H113L110 64Q99 80 88 64ZM130 55H158L153 71Q143 86 134 71Z" fill={gold} />
          <path d="M99 77V123M82 127H116M143 86V127M129 131H159" stroke={gold} stroke-width="3" />
          <path d="m167 24 4 8 9 4-9 4-4 9-4-9-8-4 8-4Z" fill={gold} />
        </>
      );
      break;
    case 'repertoire':
      subject = (
        <>
          {book(90, 88, -17)}
          {book(148, 88, 17)}
          {mask(119, 52, 0, true)}
        </>
      );
      break;
    case 'encore':
      subject = (
        <>
          {person(120, 52, 1.1)}
          <path
            d="M69 108Q37 63 82 39L78 56M82 39 61 38M171 49Q204 98 160 118L166 100M160 118 182 120"
            fill="none"
            stroke={gold}
            stroke-width="5"
          />
        </>
      );
      break;
    case 'duet':
      subject = (
        <>
          {person(86, 67, 0.9)}
          {person(151, 67, 0.9)}
          <path d="M110 47V24L133 19V42" fill="none" stroke={gold} stroke-width="3" />
          <ellipse cx="104" cy="47" rx="7" ry="5" fill={gold} />
          <ellipse cx="127" cy="43" rx="7" ry="5" fill={gold} />
        </>
      );
      break;
    case 'readingroom':
      subject = (
        <>
          {book(120, 105)}
          <path d="M117 83V47M94 48H146L133 24H107ZM102 85H139" stroke={gold} stroke-width="3" fill={paper} />
          <path d="M71 35V82M64 38V82M174 29V84M180 40V84" stroke={rose} stroke-width="5" />
        </>
      );
      break;
    case 'cashbox':
      subject = (
        <>
          <path d="M62 68H178V123H62Z" fill={ink} stroke={gold} stroke-width="3" />
          <path d="m62 68 17-24h82l17 24Z" fill={rose} stroke={gold} stroke-width="2" />
          <path d="M65 82H174M108 68V91H132V68" fill="none" stroke={gold} />
          {coin(158, 111, 20, 1)}
        </>
      );
      break;
    case 'audition':
      subject = (
        <>
          {person(119, 52, 1.15)}
          <path d="M56 23 99 135M183 23 140 135" stroke={gold} opacity=".7" />
          <path d="M77 139H163M90 144H150" stroke={paper} />
        </>
      );
      break;
    case 'stagedoor':
      subject = (
        <>
          <path d="M72 133V25H167V133Z" fill={gold} />
          <path d="M80 132V33H158V132Z" fill={ink} />
          <path d="m85 38 53 16v65l-53 9Z" fill={rose} />
          <circle cx="128" cy="87" r="3" fill={paper} />
          <path d="m140 68 8 14 15 3-12 10 1 16-12-8Z" fill={gold} />
          <path d="M61 139H177" stroke={gold} />
        </>
      );
      break;
    case 'doublebill':
      subject = (
        <>
          {mask(93, 73, -17, true)}
          {mask(150, 85, 17, false)}
        </>
      );
      break;
    case 'busker':
      subject = (
        <>
          {person(111, 63, 0.95, true)}
          <path d="M110 99 163 57M148 70 159 84" stroke={gold} stroke-width="5" />
          <ellipse cx="108" cy="100" rx="21" ry="16" fill={rose} stroke={gold} stroke-width="2" />
          <ellipse cx="106" cy="98" rx="6" ry="5" fill={ink} />
          <path d="M151 127H188L181 116H159Z" fill={gold} />
        </>
      );
      break;
    case 'critic':
      subject = (
        <>
          {person(95, 57, 1, true)}
          {book(153, 105, 8)}
          <path d="m169 69 14-39 6 4-16 37Z" fill={rose} />
          <circle cx="101" cy="62" r="6" stroke={paper} fill="none" />
        </>
      );
      break;
  }
  return (
    <svg
      class={`gg-art ${panorama ? 'gg-panorama' : ''}`}
      viewBox="0 0 240 150"
      role="img"
      aria-label={`${kind} original theatre illustration`}
    >
      <defs>
        <linearGradient id={`${id}-bg`} x2="0" y2="1">
          <stop stop-color={tone} />
          <stop offset="1" stop-color={ink} />
        </linearGradient>
        <radialGradient id={`${id}-light`}>
          <stop stop-color={gold} stop-opacity=".25" />
          <stop offset="1" stop-color={gold} stop-opacity="0" />
        </radialGradient>
      </defs>
      <path d="M0 0H240V150H0Z" fill={`url(#${id}-bg)`} />
      <path d="M28 150 120 5 212 150Z" fill={`url(#${id}-light)`} />
      {[0, 1, 2, 3, 4, 5, 6].map((n) => (
        <path key={n} d={`M120 145 ${18 + n * 34} 0`} stroke={gold} opacity=".055" stroke-width="9" />
      ))}
      <path
        d="M8 142V8H232V142ZM13 137V13H227V137"
        fill="none"
        stroke={gold}
        opacity=".55"
        stroke-width=".7"
      />
      <path d="M0 0H43Q40 45 20 68L0 84ZM240 0H197Q200 45 220 68L240 84Z" fill={tone} />
      <path
        d="M9 3Q21 48 3 79M24 3Q34 39 16 66M231 3Q219 48 237 79M216 3Q206 39 224 66"
        fill="none"
        stroke={gold}
        opacity=".3"
      />
      {subject}
      <path d="m15 15 9 0-9 9Zm210 0-9 0 9 9ZM15 135l9 0-9-9Zm210 0-9 0 9-9Z" fill={gold} />
    </svg>
  );
}
