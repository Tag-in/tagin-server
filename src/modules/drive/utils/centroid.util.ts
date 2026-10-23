import type { EntityManager } from 'typeorm';

/**
 * 폴더 centroid는 "폴더 직속의 살아 있는 항목 벡터의 합"이고 item_count는 그 개수다.
 * 항목이 폴더를 떠나거나 휴지통으로 가면 빼고, 들어오거나 복원되면 더한다.
 * 항목의 folder_id·deleted_at을 바꾸기 *전에* 호출해야 한다 (현재 소속 폴더를 읽는다).
 */

/** 항목들을 각자의 폴더 centroid에서 뺀다. 직속 항목이 없어진 폴더의 centroid는 null이 된다. */
export const removeItemsFromFolders = async (
  em: EntityManager,
  itemIds: string[],
): Promise<void> => {
  if (itemIds.length === 0) return;
  await em.query(
    `UPDATE drive_folders f
        SET centroid = CASE WHEN f.item_count <= m.cnt THEN NULL ELSE f.centroid - m.vsum END,
            item_count = GREATEST(f.item_count - m.cnt, 0),
            updated_at = now()
       FROM (SELECT folder_id, sum(embedding) AS vsum, count(*) AS cnt
               FROM drive_items WHERE id = ANY($1::uuid[]) GROUP BY folder_id) m
      WHERE f.id = m.folder_id`,
    [itemIds],
  );
};

/** 항목들을 centroid에 더한다. intoFolderId가 있으면 그 폴더에, 없으면 항목 각자의 폴더에 더한다. */
export const addItemsToFolders = async (
  em: EntityManager,
  itemIds: string[],
  intoFolderId: string | null = null,
): Promise<void> => {
  if (itemIds.length === 0) return;
  await em.query(
    `UPDATE drive_folders f
        SET centroid = COALESCE(f.centroid + m.vsum, m.vsum),
            item_count = f.item_count + m.cnt,
            updated_at = now()
       FROM (SELECT COALESCE($2::uuid, folder_id) AS folder_id,
                    sum(embedding) AS vsum, count(*) AS cnt
               FROM drive_items WHERE id = ANY($1::uuid[]) GROUP BY 1) m
      WHERE f.id = m.folder_id`,
    [itemIds, intoFolderId],
  );
};
