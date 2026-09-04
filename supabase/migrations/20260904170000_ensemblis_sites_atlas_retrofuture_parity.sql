-- Upgrade only the unpublished Atlas shadow draft to the Atlas-derived reusable
-- editorial-retrofuture template. This migration does not activate host routing,
-- verify DNS, mark a domain primary, or mutate any published site version.

do $$
declare
  atlas_artist public.artists%rowtype;
  atlas_site public.artist_sites%rowtype;
  atlas_draft public.artist_site_versions%rowtype;
  releases_snapshot jsonb;
  latest_artwork text;
begin
  select artist.* into atlas_artist
  from public.artists artist
  where artist.status = 'active'
    and lower(trim(artist.name)) = 'atlas irwin'
  order by
    case when exists (
      select 1 from public.releases release
      where release.artist_id = artist.id
        and lower(trim(release.artist)) = 'atlas irwin'
    ) then 0 else 1 end,
    artist.created_at
  limit 1;

  if atlas_artist.id is null then
    return;
  end if;

  select * into atlas_site
  from public.artist_sites
  where artist_id = atlas_artist.id;

  if atlas_site.id is null or atlas_site.published_version_id is not null or atlas_site.draft_version_id is null then
    return;
  end if;

  select * into atlas_draft
  from public.artist_site_versions
  where id = atlas_site.draft_version_id
    and site_id = atlas_site.id
    and status = 'draft';

  if atlas_draft.id is null then
    return;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', release.id,
        'slug', release.slug,
        'title', release.title,
        'releaseType', release.release_type,
        'releaseDate', release.release_date,
        'story', release.story,
        'artworkUrl', case
          when release.artwork_url ~* '^https?://' then release.artwork_url
          when release.artwork_url like '/%' then 'https://atlasirwin.com' || release.artwork_url
          else null
        end,
        'genre', release.genre,
        'links',
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'label', coalesce(link.label, link.provider::text),
                'href', link.external_url,
                'provider', link.provider::text
              )
              order by link.created_at
            )
            from public.release_external_links link
            where link.release_id = release.id
              and link.artist_id = atlas_artist.id
              and link.external_url is not null
          ), '[]'::jsonb)
          || case when release.spotify_url is not null then jsonb_build_array(jsonb_build_object('label','Spotify','href',release.spotify_url,'provider','spotify')) else '[]'::jsonb end
          || case when release.soundcloud_url is not null then jsonb_build_array(jsonb_build_object('label','SoundCloud','href',release.soundcloud_url,'provider','soundcloud')) else '[]'::jsonb end
          || case when release.youtube_url is not null then jsonb_build_array(jsonb_build_object('label','YouTube','href',release.youtube_url,'provider','youtube')) else '[]'::jsonb end
          || case when coalesce(release.smart_link_url, release.cta_href) is not null then jsonb_build_array(jsonb_build_object('label',coalesce(release.cta_label,'Listen'),'href',coalesce(release.smart_link_url, release.cta_href),'provider','smart-link')) else '[]'::jsonb end,
        'tracks', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', track.id,
              'title', track.title,
              'trackNumber', track.track_number,
              'displayOrder', track.display_order,
              'durationSeconds', track.duration,
              'audioUrl', case
                when track.audio_url ~* '^https?://' or track.audio_url like '/%' then track.audio_url
                else null
              end,
              'soundcloudUrl', track.soundcloud_url,
              'spotifyUrl', track.spotify_url,
              'isPrimary', track.is_primary
            )
            order by track.display_order, track.track_number nulls last, track.title
          )
          from public.tracks track
          where track.release_id = release.id
            and track.artist_id = atlas_artist.id
        ), '[]'::jsonb)
      )
      order by release.release_date desc nulls last, release.updated_at desc
    ),
    '[]'::jsonb
  ) into releases_snapshot
  from public.releases release
  where release.artist_id = atlas_artist.id
    and release.is_public = true
    and release.publish_state = 'live'
    and release.is_archived = false;

  select case
    when release.artwork_url ~* '^https?://' then release.artwork_url
    when release.artwork_url like '/%' then 'https://atlasirwin.com' || release.artwork_url
    else null
  end into latest_artwork
  from public.releases release
  where release.artist_id = atlas_artist.id
    and release.is_public = true
    and release.publish_state = 'live'
    and release.is_archived = false
  order by release.release_date desc nulls last, release.updated_at desc
  limit 1;

  update public.artist_site_versions
  set
    template_key = 'editorial-retrofuture',
    template_version = 1,
    config = jsonb_build_object(
      'theme', jsonb_build_object(
        'background', '#f4eddd',
        'foreground', '#111111',
        'muted', '#6f685f',
        'accent', '#b6ff3b',
        'surface', '#f8f1e4'
      ),
      'sectionOrder', jsonb_build_array('hero','releases','platforms','about','contact','newsletter'),
      'hiddenSections', '[]'::jsonb,
      'highlightedReleaseIds', '[]'::jsonb,
      'retrofuture', jsonb_build_object(
        'logoUrl', '/atlas-irwin-logo-sign.svg',
        'heroTaglines', jsonb_build_array('Groove driven.','Systems minded.','Sound in motion.'),
        'primaryCtaLabel', 'I want to funk now',
        'primaryCtaHref', '#release-widget',
        'secondaryCtaLabel', 'Contact',
        'secondaryCtaHref', '#contact',
        'listenHeading', 'Listen Everywhere',
        'platformLinks', jsonb_build_array(
          jsonb_build_object('label','SoundCloud','href','https://soundcloud.com/atlas-irwin','provider','soundcloud'),
          jsonb_build_object('label','Spotify','href','https://open.spotify.com/artist/5BHcMdmbmxYwIFzqZvE3pc?si=a7EU_3TdQYSjGRAcvnJ8pg','provider','spotify'),
          jsonb_build_object('label','Deezer','href','https://www.deezer.com/en/artist/386920031','provider','deezer'),
          jsonb_build_object('label','Apple Music','href','https://music.apple.com/us/artist/atlas-irwin/1895148790','provider','apple-music'),
          jsonb_build_object('label','YouTube','href','https://www.youtube.com/@AtlasIrwin','provider','youtube')
        ),
        'aboutHeading', 'Retro-Futuristic Electronic Music',
        'aboutParagraphs', jsonb_build_array(
          'Atlas Irwin is a retro-futuristic electronic music project rooted in nu-disco, funk, house, and EDM.',
          'The sound blends soulful warmth, polished club energy, and luminous electronic texture into tracks built for movement, color, and emotional release.',
          'Artificial intelligence tools are part of the creative language, expanding the palette while human instinct, taste, and direction stay at the center.'
        ),
        'aboutImageUrl', '/bio-image.webp',
        'aboutImageAlt', 'Atlas Irwin visual portrait',
        'capabilities', jsonb_build_array(
          'Original productions','Hybrid live/DJ sets','Sound identities','Visual systems','Release worlds','Commissioned work'
        ),
        'values', jsonb_build_array('Groove-led','Signal-shaped','Human-finished'),
        'contactHeading', 'Let''s Talk',
        'contactCopy', 'For bookings, collaborations, remix requests, and commissioned work, send a short note. Direct email works too.',
        'contactEmail', 'atlas.irwin.music@gmail.com',
        'contactFormEnabled', true,
        'contactFormEndpoint', '/api/contact',
        'newsletterEnabled', true,
        'newsletterEndpoint', '/api/newsletter',
        'newsletterKicker', 'Newsletter',
        'newsletterHeading', 'Stay In The Loop',
        'newsletterCopy', 'Occasional release notes, live dates, sketches from the studio, and early listens before they land everywhere else.'
      )
    ),
    content_snapshot = jsonb_build_object(
      'schemaVersion', 1,
      'artist', jsonb_build_object(
        'id', atlas_artist.id,
        'name', atlas_artist.name,
        'slug', atlas_artist.slug,
        'bio', null,
        'avatarUrl', atlas_artist.avatar_url,
        'accentColor', atlas_artist.accent_color
      ),
      'releases', releases_snapshot,
      'socialLinks', '[]'::jsonb,
      'contact', jsonb_build_object('email', null),
      'seo', jsonb_build_object(
        'title', 'Atlas Irwin — Retro-Futuristic Electronic Music',
        'description', 'Atlas Irwin is a retro-futuristic electronic music project rooted in nu-disco, funk, house, and EDM, blending soulful warmth, polished club energy, and luminous electronic texture.',
        'imageUrl', coalesce(latest_artwork, 'https://atlasirwin.com/atlas-cover.png')
      )
    )
  where id = atlas_draft.id
    and status = 'draft';

  update public.artist_sites
  set template_key = 'editorial-retrofuture'
  where id = atlas_site.id
    and published_version_id is null;
end
$$;
